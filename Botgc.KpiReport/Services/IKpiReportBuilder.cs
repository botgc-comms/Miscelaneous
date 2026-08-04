using Botgc.KpiReport.Models;

namespace Botgc.KpiReport.Services;

public interface IKpiReportBuilder
{
    KpiReportDocument Build(KpiReportData source);
}
