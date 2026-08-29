FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY BOTGC.EventPlaybook.API/BOTGC.EventPlaybook.API.csproj BOTGC.EventPlaybook.API/
RUN dotnet restore BOTGC.EventPlaybook.API/BOTGC.EventPlaybook.API.csproj

COPY BOTGC.EventPlaybook.API/ BOTGC.EventPlaybook.API/
RUN dotnet publish BOTGC.EventPlaybook.API/BOTGC.EventPlaybook.API.csproj \
    --configuration Release \
    --output /app/publish \
    --no-restore \
    -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

ENV ASPNETCORE_URLS=http://0.0.0.0:10000 \
    ASPNETCORE_ENVIRONMENT=Production

EXPOSE 10000

COPY --from=build --chown=app:app /app/publish ./

USER app
ENTRYPOINT ["dotnet", "BOTGC.EventPlaybook.API.dll"]
