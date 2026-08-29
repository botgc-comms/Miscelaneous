# syntax=docker/dockerfile:1

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY BOTGC.EventPlaybook.Web/BOTGC.EventPlaybook.Web.csproj BOTGC.EventPlaybook.Web/
RUN dotnet restore BOTGC.EventPlaybook.Web/BOTGC.EventPlaybook.Web.csproj

COPY BOTGC.EventPlaybook.Web/ BOTGC.EventPlaybook.Web/
RUN dotnet publish BOTGC.EventPlaybook.Web/BOTGC.EventPlaybook.Web.csproj \
    --configuration Release \
    --output /app/publish \
    --no-restore \
    -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_URLS=http://0.0.0.0:10000 \
    ASPNETCORE_ENVIRONMENT=Production

EXPOSE 10000

COPY --from=build --chown=app:app /app/publish ./
RUN mkdir -p /app/App_Data && chown -R app:app /app

USER app
ENTRYPOINT ["dotnet", "BOTGC.EventPlaybook.Web.dll"]
