#!/bin/bash

# Docker publish script for aztec-automator-service
# Usage: ./publish-docker.sh [version] [dockerhub-username]

set -e

# Default values
VERSION=${1:-latest}
DOCKERHUB_USERNAME=${2}

# Check if username is provided
if [ -z "$DOCKERHUB_USERNAME" ]; then
    echo "❌ Error: Docker Hub username is required"
    echo "Usage: ./publish-docker.sh [version] [dockerhub-username]"
    echo "Example: ./publish-docker.sh v1.0.0 myusername"
    exit 1
fi

# Image name
IMAGE_NAME="aztec-automator-service"
FULL_IMAGE_NAME="${DOCKERHUB_USERNAME}/${IMAGE_NAME}:${VERSION}"

echo "🚀 Publishing Docker image: ${FULL_IMAGE_NAME}"
echo ""

# Step 1: Build the image
echo "📦 Building Docker image..."
./build-docker.sh $VERSION $DOCKERHUB_USERNAME

# Step 2: Login to Docker Hub
echo ""
echo "🔐 Logging in to Docker Hub..."
docker login

# Step 3: Push the image
echo ""
echo "⬆️  Pushing image to Docker Hub..."
docker push ${FULL_IMAGE_NAME}

# Step 4: Tag as latest if not already latest
if [ "$VERSION" != "latest" ]; then
    echo ""
    echo "🏷️  Tagging as latest..."
    docker tag ${FULL_IMAGE_NAME} ${DOCKERHUB_USERNAME}/${IMAGE_NAME}:latest
    docker push ${DOCKERHUB_USERNAME}/${IMAGE_NAME}:latest
fi

echo ""
echo "✅ Successfully published Docker image!"
echo "Image: ${FULL_IMAGE_NAME}"
echo ""
echo "Others can now use your image with:"
echo "  docker pull ${FULL_IMAGE_NAME}"
echo "  docker run -p 3000:3000 ${FULL_IMAGE_NAME}"
echo ""
echo "View your image at: https://hub.docker.com/r/${DOCKERHUB_USERNAME}/${IMAGE_NAME}" 