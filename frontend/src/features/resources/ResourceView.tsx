import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Project } from '../../api/types'
import { formatDate, round } from '../../lib/format'

/** RF-11 / RF-46: workload per member and over-allocated days. */
export function ResourceView({ project }: { project: Project }) {
  const { data, isLoading } = useQuery({
    queryKey: ['resource-load', project.id, project.updated_at],
    queryFn: () => api.resourceLoad(project.id),
  })

  return (
    <div className="page-section">
      <h2>Carga de recursos</h2>
      <p className="muted">
        Horas asignadas por día según el cronograma calculado y la dedicación de cada asignación. El MVP no nivela
        automáticamente: señala los días en que se supera la disponibilidad del integrante.
      </p>
      {isLoading && <p className="muted">Calculando…</p>}
      {data && data.length === 0 && <p className="muted">No hay integrantes registrados.</p>}
      {data?.map((load) => {
        const peak = Math.max(load.capacity_minutes_per_day, ...load.days.map((d) => d.minutes))
        return (
          <section key={load.member_id} className="resource-card">
            <header>
              <strong>{load.name}</strong>
              <span className="muted small">
                Capacidad {round(load.capacity_minutes_per_day / 60)} h/día · Total asignado {round(load.total_minutes / 60)} h
              </span>
              {load.overallocated_days > 0
                ? <span className="badge badge-critical">Sobreasignado {load.overallocated_days} día(s)</span>
                : load.days.length > 0 && <span className="badge badge-ok">Sin sobreasignación</span>}
            </header>
            {load.days.length === 0 ? <p className="muted small">Sin actividades asignadas.</p> : (
              <div className="load-chart" role="img" aria-label={`Carga diaria de ${load.name}`}>
                {load.days.map((d) => (
                  <div key={d.day} className="load-col" title={`${formatDate(d.day)}: ${round(d.minutes / 60)} h`}>
                    <div className={`load-bar ${d.overallocated ? 'over' : ''}`} style={{ height: `${(d.minutes / peak) * 100}%` }} />
                  </div>
                ))}
                <div className="capacity-line" style={{ bottom: `${(load.capacity_minutes_per_day / peak) * 100}%` }} />
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
