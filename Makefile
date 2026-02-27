.PHONY: all test lint typecheck build dev

all: lint typecheck test

test:
	cd platform && npm test

lint:
	cd platform && npx tsc --noEmit

typecheck:
	cd platform && npx tsc --noEmit

build:
	cd platform && npm run build

dev:
	cd platform && npm run dev
