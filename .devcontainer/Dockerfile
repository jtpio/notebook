# See here for image contents: https://github.com/microsoft/vscode-dev-containers/tree/v0.238.1/containers/python-3-miniconda/.devcontainer/base.Dockerfile

FROM mcr.microsoft.com/vscode/devcontainers/miniconda:0-3

COPY .devcontainer/environment.yml /tmp/conda-tmp/
RUN umask 0002 && /opt/conda/bin/conda env update -n base -f /tmp/conda-tmp/environment.yml \
    && rm -rf /tmp/conda-tmp
