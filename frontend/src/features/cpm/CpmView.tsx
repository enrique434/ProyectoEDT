import type { Project } from '../../api/types'
import { KIND_LABEL } from '../../lib/labels'
import { formatDate, minutesToDays, percent, round } from '../../lib/format'

/** CU-16 / CU-17: CPM table (ES, EF, LS, LF, floats) and the critical path. */
export function CpmView({ project }: { project: Project }) {
  const mpd = project.settings.minutes_per_day
  const schedule = project.schedule
  const byId = new Map(project.items.map((i) => [i.id, i]))
  const critical = schedule?.critical_item_ids.map((id) => byId.get(id)!).filter(Boolean) ?? []
  // Chain = critical leaves + sprints whose own timebox is critical (none of their children is).
  const chain = project.items
    .filter((i) => i.schedule?.is_critical && (!i.is_summary || (i.kind === 'sprint'
      && !project.items.some((c) => c.parent_id === i.id && c.schedule?.is_critical))))
    .sort((a, b) => a.schedule!.early_start - b.schedule!.early_start || a.schedule!.early_finish - b.schedule!.early_finish)
  const leaves = project.items.filter((i) => !i.is_summary && i.schedule)
  const sigmaDays = schedule ? schedule.pert_std_dev_minutes / mpd : 0

  return (
    <div className="page-section">
      <h2>Ruta crítica y CPM</h2>
      {!schedule ? <p className="muted">Aún no hay cronograma.</p> : (
        <>
          <div className="cards">
            <div className="card"><span>Duración del proyecto</span><strong>{schedule.duration_days} días lab.</strong></div>
            <div className="card"><span>Fin calculado</span><strong>{formatDate(schedule.finish)}</strong></div>
            <div className="card"><span>Actividades críticas</span><strong>{critical.length} / {leaves.length}</strong></div>
            <div className="card"><span>σ PERT de la ruta crítica</span><strong>{round(sigmaDays)} días</strong></div>
            <div className="card"><span>P(terminar ≤ fecha objetivo)</span><strong>{project.target_date ? percent(schedule.target_probability) : 'Sin fecha objetivo'}</strong></div>
          </div>

          <h3>Secuencia crítica</h3>
          {chain.length === 0 ? <p className="muted">No hay actividades críticas.</p> : (
            <div className="critical-chain">
              {chain.map((item, index) => (
                <span key={item.id} className="chain-step">
                  {index > 0 && <span className="chain-arrow">→</span>}
                  <span className="badge badge-critical" title={item.kind === 'sprint' ? 'Timebox del sprint crítico' : undefined}>
                    {item.kind === 'sprint' ? '⟳ ' : ''}{item.wbs_code} {item.name}
                  </span>
                </span>
              ))}
            </div>
          )}
          <p className="hint">
            Una actividad es crítica si su holgura total es 0 (RN-22): cualquier retraso en ella retrasa el fin del proyecto.
            Los valores se expresan en días laborables desde el inicio del proyecto.
          </p>

          <h3>Tabla CPM</h3>
          <table className="table compact cpm-table">
            <thead>
              <tr>
                <th>EDT</th><th>Actividad</th><th>Tipo</th><th className="num">Dur.</th>
                <th className="num">ES</th><th className="num">EF</th><th className="num">LS</th><th className="num">LF</th>
                <th className="num">Holgura total</th><th className="num">Holgura libre</th><th>Crítica</th>
              </tr>
            </thead>
            <tbody>
              {project.items.filter((i) => i.schedule).map((item) => {
                const s = item.schedule!
                const d = (m: number) => minutesToDays(m, mpd)
                return (
                  <tr key={item.id} className={`${s.is_critical ? 'critical-row' : ''} ${item.is_summary ? 'summary-row' : ''}`}>
                    <td>{item.wbs_code}</td>
                    <td style={{ paddingLeft: 8 + item.level * 12 }}>{item.name}</td>
                    <td>{KIND_LABEL[item.kind]}</td>
                    <td className="num">{d(s.early_finish - s.early_start)}</td>
                    <td className="num">{d(s.early_start)}</td>
                    <td className="num">{d(s.early_finish)}</td>
                    <td className="num">{d(s.late_start)}</td>
                    <td className="num">{d(s.late_finish)}</td>
                    <td className="num">{d(s.total_float)}</td>
                    <td className="num">{d(s.free_float)}</td>
                    <td>{s.is_critical ? '●' : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
