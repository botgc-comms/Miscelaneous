using System.Net.Http.Json;
using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public sealed class TeeTimeUsageClient(
    HttpClient httpClient)
    : ITeeTimeUsageClient
{
    private readonly HttpClient _httpClient =
        httpClient ??
        throw new ArgumentNullException(
            nameof(httpClient));

    public async Task<List<TeeTimeUsageRowData>> GetAsync(
        DateOnly startDate,
        DateOnly endDate,
        CancellationToken cancellationToken = default)
    {
        var relativeUrl =
            "api/teesheets/usage" +
            $"?startDate={startDate:yyyy-MM-dd}" +
            $"&endDate={endDate:yyyy-MM-dd}";

        try
        {
            using var response =
                await _httpClient.GetAsync(
                    relativeUrl,
                    cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                throw new TeeTimeUsageImportException(
                    "The tee-time utilisation service returned " +
                    $"{(int)response.StatusCode} " +
                    $"{response.ReasonPhrase}.");
            }

            var rows =
                await response.Content.ReadFromJsonAsync<
                    List<TeeTimeUsageRowData>>(
                        cancellationToken:
                            cancellationToken);

            return rows ??
                throw new TeeTimeUsageImportException(
                    "The tee-time utilisation service " +
                    "returned an empty response.");
        }
        catch (TeeTimeUsageImportException)
        {
            throw;
        }
        catch (OperationCanceledException exception)
            when (!cancellationToken.IsCancellationRequested)
        {
            throw new TeeTimeUsageImportException(
                "The tee-time utilisation service timed out.",
                exception);
        }
        catch (HttpRequestException exception)
        {
            throw new TeeTimeUsageImportException(
                "The tee-time utilisation service " +
                "could not be reached.",
                exception);
        }
        catch (System.Text.Json.JsonException exception)
        {
            throw new TeeTimeUsageImportException(
                "The tee-time utilisation response " +
                "could not be read.",
                exception);
        }
    }
}