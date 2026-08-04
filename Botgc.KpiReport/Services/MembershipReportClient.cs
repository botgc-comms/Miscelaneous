using System.Net.Http.Json;
using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public sealed class MembershipReportClient(
    HttpClient httpClient)
    : IMembershipReportClient
{
    private readonly HttpClient _httpClient =
        httpClient ?? throw new ArgumentNullException(nameof(httpClient));

    public async Task<MembershipReportResponse> GetAsync(
        DateOnly windowStart,
        CancellationToken cancellationToken = default)
    {
        var relativeUrl =
            $"api/members/report?windowStart={windowStart:yyyy-MM-dd}";

        try
        {
            using var response = await _httpClient.GetAsync(
                relativeUrl,
                cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                throw new MembershipReportImportException(
                    $"The membership report service returned " +
                    $"{(int)response.StatusCode} {response.ReasonPhrase}.");
            }

            var report =
                await response.Content
                    .ReadFromJsonAsync<MembershipReportResponse>(
                        cancellationToken: cancellationToken);

            return report
                ?? throw new MembershipReportImportException(
                    "The membership report service returned an empty response.");
        }
        catch (MembershipReportImportException)
        {
            throw;
        }
        catch (OperationCanceledException exception)
            when (!cancellationToken.IsCancellationRequested)
        {
            throw new MembershipReportImportException(
                "The membership report service timed out.",
                exception);
        }
        catch (HttpRequestException exception)
        {
            throw new MembershipReportImportException(
                "The membership report service could not be reached.",
                exception);
        }
        catch (System.Text.Json.JsonException exception)
        {
            throw new MembershipReportImportException(
                "The membership report response could not be read.",
                exception);
        }
    }
}