FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY web/package*.json ./
RUN npm install --global npm@11.13.0 && npm ci
COPY web/ ./
RUN npm run build

FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MUSEUM_DATA=/data MUSEUM_MODELS=/models MUSEUM_HOSTS=127.0.0.1:8792,localhost:8792 MUSEUM_CONTAINER_SETUP=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libimage-exiftool-perl libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv && uv sync --frozen --extra media --no-dev
COPY photo_museum ./photo_museum
COPY tools ./tools
COPY --from=frontend /build/dist ./web/dist
RUN useradd -u 10001 -m museum && mkdir /data /models && chown museum:museum /data /models
USER museum
EXPOSE 8792
HEALTHCHECK --interval=30s --timeout=5s CMD ["/app/.venv/bin/python","-c","import urllib.request;urllib.request.urlopen('http://127.0.0.1:8792/api/bootstrap',timeout=3)"]
CMD ["/app/.venv/bin/python","-m","photo_museum","--data","/data","--port","8792","--host","0.0.0.0"]
