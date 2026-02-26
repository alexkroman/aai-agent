.PHONY: all test test-python test-react lint lint-python lint-react format format-python format-react typecheck typecheck-python typecheck-react build

all: lint format typecheck test

test: test-python test-react

test-python:
	python -m pytest tests/ -v

test-react:
	cd packages/react && npm run test

lint: lint-python lint-react

lint-python:
	ruff check .

lint-react:
	cd packages/react && npm run lint

format: format-python format-react

format-python:
	ruff format .

format-react:
	cd packages/react && npx prettier --write "src/**/*.{ts,tsx}"

typecheck: typecheck-python typecheck-react

typecheck-python:
	pyright

typecheck-react:
	cd packages/react && npm run typecheck

build:
	cd packages/react && npm run build
