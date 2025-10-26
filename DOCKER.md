# Docker instructions

This repository is a Next.js app using Node 18 and pnpm. Below are simple instructions to build and run a production Docker image.

Build the image (from the repository root):

```powershell
docker build -t agent-starter-react:latest .
```

Run the container exposing port 3000:

```powershell
docker run -it --rm -p 3000:3000 --env-file .env.local agent-starter-react:latest
```

Notes:
- The Dockerfile uses pnpm@9.15.9 via corepack. If you need a different pnpm version, update the Dockerfile.
- Do NOT commit secrets or env files into the image. Use `--env-file` or environment variables when running the container.
- For local development with hot reload you can either run `pnpm dev` locally (recommended) or create a separate development Docker setup that mounts the source as a volume and runs `pnpm dev`.

Suggested next steps:
- (Optional) Add a `docker-compose.yml` for local dev that mounts your source and forwards port 3000.
- (Optional) Add healthchecks and a non-root user to the Dockerfile for stricter production setups.
