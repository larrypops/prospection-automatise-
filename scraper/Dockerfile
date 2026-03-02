FROM python:3.11-slim

# Dépendances système pour Chromium sur Debian Trixie
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl gnupg2 \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libx11-xcb1 libxcb-dri3-0 libxshmfence1 \
    fonts-liberation fonts-unifont fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Installer Chromium sans passer par install-deps (packages obsolètes sur Trixie)
RUN playwright install chromium

COPY . .
RUN mkdir -p logs

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget -qO- http://localhost:5000/health || exit 1

EXPOSE 5000
CMD ["python", "api.py"]
