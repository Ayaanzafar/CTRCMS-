.PHONY: run dev sqlc test tidy

run:
	go run ./cmd/server

dev:
	go run ./cmd/server

sqlc:
	cd db && go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate

tidy:
	go mod tidy

test:
	go test ./...
