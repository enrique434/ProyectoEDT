import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Project } from '../../api/types'
import { Button } from '../../components/Button'
import { Alert } from '../../components/feedback/Alert'
import { describeError } from '../../lib/errors'
import { formatDate, round } from '../../lib/format'

/** RF-11 / RF-46: workload per member and over-allocated days. */
export function ResourceView({ project }: { project: Project }) {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['resource-load', project.id, project.updated_at],
    queryFn: () => api.resourceLoad(project.id),
  })
  const overloaded = data?.filter((l) => l.overallocated_days > 0) ?? []

  return (
    <div className="page-section">
      <h2>Carga de recursos</h2>
      <p className="muted">
        Horas asignadas por día según el cronograma calculado y la dedicación de cada asignación. El MVP no nivela
        automáticamente: señala los días en que se supera la disponibilidad del integrante.
      </p>
      {isLoading && <p className="muted loading-line"><span className="spinner" /> Calculando la carga…</p>}
      {error && (
        <Alert tone="error" title="No se pudo calcular la carga de recursos"
          action={<Button size="sm" loading={isRefetching} onClick={() => refetch()}>Reintentar</Button>}>
          {describeError(error).message}
        </Alert>
      )}
      {data && data.length === 0 && (
        <Alert tone="info" title="No hay integrantes">Registre al equipo en la pestaña “Equipo” y asígnelo a las actividades.</Alert>
      )}
      {overloaded.length > 0 && (
        <Alert tone="warning" title={`${overloaded.length} integrante(s) sobreasignado(s)`}>
          {overloaded.map((l) => `${l.name} (${l.overallocated_days} día(s))`).join(' · ')}. Reduzca la dedicación,
          reasigne actividades o agregue dependencias para escalonarlas.
        </Alert>
      )}
      {data && data.length > 0 && overloaded.length === 0 && data.some((l) => l.days.length > 0) && (
        <Alert tone="success" compact>Ningún integrante supera su disponibilidad diaria.</Alert>
      )}
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
