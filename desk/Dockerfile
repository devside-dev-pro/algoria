# ALGORIA DESK — conteneur du desk d'analystes (Railway, service planifié : une exécution par jour).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY run_desk.py .

# Mémoire du desk (journal des décisions, cache) : /data — monter un volume Railway dessus pour qu'elle survive
# d'un jour à l'autre. Sans volume, le desk repart de zéro chaque matin (il tourne quand même).
ENV TRADINGAGENTS_RESULTS_DIR=/data/logs \
    TRADINGAGENTS_CACHE_DIR=/data/cache \
    TRADINGAGENTS_MEMORY_LOG_PATH=/data/memory/trading_memory.md
RUN mkdir -p /data

CMD ["python", "run_desk.py"]
