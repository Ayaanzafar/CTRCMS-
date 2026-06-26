package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	Sub  string `json:"sub"`
	Role string `json:"role"`
	jwt.RegisteredClaims
}

func SignToken(userID, roleCode, secret, expiresIn string) (string, error) {
	duration, err := time.ParseDuration(expiresIn)
	if err != nil {
		// Support simple hour suffix like "8h" from Node config — ParseDuration handles this.
		return "", fmt.Errorf("invalid JWT_EXPIRES_IN: %w", err)
	}

	claims := Claims{
		Sub:  userID,
		Role: roleCode,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func VerifyToken(tokenString, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}
