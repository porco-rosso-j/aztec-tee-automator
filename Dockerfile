FROM --platform=linux/amd64 node:lts-bookworm-slim
# FROM ubuntu:24.04
SHELL ["/bin/bash", "-c"]

# system dependencies
RUN apt update && apt install -y \
    curl \
    git \
    build-essential \
    g++ \
    make \
    python3 \
    python-is-python3 \
    pkg-config \
    libc6-dev \
    libc++-dev \
    ca-certificates \
    gnupg \
    lsb-release \
    cmake \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Use Node.js 18 instead of 20
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm tsx

RUN useradd -m appuser
USER appuser
WORKDIR /home/appuser/app

COPY --chown=appuser:appuser package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
# optional but recommended
RUN pnpm rebuild lmdb

# Copy source code
COPY --chown=appuser:appuser . .

# Expose port (adjust if your app uses a different port)

EXPOSE 3000
ENV PORT=3000

# Start the application
# CMD ["./start.sh"]
CMD ["pnpm", "start"]