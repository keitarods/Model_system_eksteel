FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends calculix-ccx libglu1-mesa libgl1 libgomp1 && rm -rf /var/lib/apt/lists/*
# Gmsh wheels link these display libraries even for headless meshing.
RUN apt-get update && apt-get install -y --no-install-recommends libxrender1 libxcursor1 libxft2 libfontconfig1 libxinerama1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY engine.py worker.py app.py elements.py contacts.py unilateral.py healthcheck.py ./
RUN useradd --create-home fea
USER fea
ENV OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["python", "healthcheck.py"]
EXPOSE 8090
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
