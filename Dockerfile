FROM python:3.10-slim

# Install system dependencies needed for LightGBM on Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application files (except those in .dockerignore)
COPY . .

# Set default port and expose it
ENV PORT=8000
EXPOSE 8000

# Run uvicorn on startup, dynamically binding to the port set by the cloud environment
CMD ["sh", "-c", "python -m uvicorn api.main:app --host 0.0.0.0 --port $PORT"]
