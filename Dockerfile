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


# # Install Docker
# RUN mkdir -p /etc/apt/keyrings && \
#     curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
#     echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
#     apt-get update && \
#     apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin && \
#     rm -rf /var/lib/apt/lists/*

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