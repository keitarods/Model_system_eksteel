FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends calculix-ccx libglu1-mesa libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY engine.py worker.py app.py ./
RUN useradd --create-home fea
USER fea
ENV OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
EXPOSE 8090
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
