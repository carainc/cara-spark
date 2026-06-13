# Cara Spark — agent-facing command surface.
# Every gate in the runbook ladder maps to a target here. CI-safe, non-interactive.
.PHONY: install build test typecheck lint dev e2e eval db-migrate db-seed up down deploy smoke aws-ok

install:        ## install deps
	pnpm install --frozen-lockfile || pnpm install

build:          ## prisma generate + next build
	pnpm build

typecheck:      ## tsc --noEmit
	pnpm typecheck

# Run all tests, or a single file:  make test ONE=engine/__tests__/adjudicate.test.ts
test:
	pnpm vitest run $(ONE)

lint:           ## next lint
	pnpm lint

dev:            ## next dev
	pnpm dev

e2e:            ## playwright
	pnpm e2e

eval:           ## triage eval release gate (local fallback)
	pnpm eval

db-migrate:     ## apply schema
	pnpm db:push

db-seed:        ## seed super-admin + sample agent + referral resources
	pnpm db:seed

up:             ## docker compose up (full stack)
	docker compose up --build

down:
	docker compose down -v

aws-ok:         ## assert cara-prod SSO session alive before any deploy
	bash scripts/aws_session_ok.sh

deploy:         ## terraform apply -> EC2 (runs aws-ok first)
	bash scripts/aws_session_ok.sh && cd terraform && terraform apply

smoke:          ## smoke the deployed URL (URL=https://...)
	bash scripts/smoke.sh $(URL)
