// Single catalog of user-facing texts for actions: same wording and tone everywhere.
import type { Dependency, TimeUnit, WorkItem, WorkItemKind } from '../api/types'
import { KIND_LABEL } from './labels'
import { formatDate, formatLag } from './format'

export interface Notice {
  title: string
  message?: string
  details?: string[]
}

type Gender = 'm' | 'f'
const KIND_GENDER: Record<WorkItemKind, Gender> = {
  phase: 'f', sprint: 'm', story: 'f', task: 'f', subtask: 'f', milestone: 'm',
}
const g = (gender: Gender, masculine: string, feminine: string) => (gender === 'm' ? masculine : feminine)
const q = (name: string) => `“${name}”`

/** "la tarea", "el sprint"… */
export function theKind(kind: WorkItemKind): string {
  return `${g(KIND_GENDER[kind], 'el', 'la')} ${KIND_LABEL[kind].toLowerCase()}`
}

export function dependencyText(pred: string, succ: string, type: string, lagValue: number, lagUnit: TimeUnit): string {
  return `${pred} → ${succ} (${type}${formatLag(lagValue, lagUnit)})`
}

export const MSG = {
  // ------------------------------------------------------------------ generic
  noChanges: { title: 'Sin cambios', message: 'No hay modificaciones que guardar.' } as Notice,
  fixFields: (details: string[]): Notice => ({
    title: 'Revise los campos marcados',
    message: 'Corrija los datos indicados antes de guardar.',
    details,
  }),
  newWarnings: (warnings: string[]): Notice => ({
    title: 'Nuevas alertas de planificación',
    message: 'El último cambio generó situaciones que conviene revisar.',
    details: warnings,
  }),
  discard: {
    title: '¿Descartar los cambios?',
    message: 'Hay modificaciones sin guardar. Si continúa, se perderán.',
    confirmLabel: 'Descartar cambios',
    cancelLabel: 'Seguir editando',
  },

  // ----------------------------------------------------------------- projects
  projectCreated: (name: string): Notice => ({
    title: 'Proyecto creado',
    message: `${q(name)} está listo. Empiece a construir la EDT.`,
  }),
  sampleCreated: (name: string): Notice => ({
    title: 'Proyecto de ejemplo creado',
    message: `${q(name)} incluye EDT, dependencias, PERT, equipo y cronograma calculado.`,
  }),
  projectUpdated: { title: 'Proyecto actualizado', message: 'La configuración se guardó y el cronograma se recalculó.' } as Notice,
  projectDeleted: (name: string): Notice => ({ title: 'Proyecto eliminado', message: `${q(name)} y todos sus datos se eliminaron.` }),
  confirmDeleteProject: (name: string, items: number) => ({
    title: `¿Eliminar el proyecto ${q(name)}?`,
    message: 'Se eliminarán de forma permanente:',
    details: [`${items} actividad(es) de la EDT con sus dependencias`, 'El calendario, el equipo y las asignaciones', 'El cronograma calculado'],
    confirmLabel: 'Eliminar proyecto',
  }),
  confirmMethodologyChange: (from: string, to: string) => ({
    title: `¿Cambiar la metodología de ${from} a ${to}?`,
    message: 'La estructura actual de la EDT se validará contra las reglas de la nueva metodología. Si algún elemento no está permitido, el cambio se rechazará sin modificar nada.',
    confirmLabel: 'Cambiar metodología',
  }),
  confirmDayLengthChange: (from: number, to: number) => ({
    title: `¿Cambiar la jornada de ${from} h a ${to} h por día?`,
    message: 'Las duraciones conservan su valor en la unidad elegida (5 días siguen siendo 5 días), pero las fechas calculadas cambiarán.',
    confirmLabel: 'Aplicar cambio',
  }),

  // ---------------------------------------------------------------- schedule
  recalculated: (finish: string | undefined): Notice => ({
    title: 'Cronograma recalculado',
    message: finish ? `CPM aplicado. Fin estimado del proyecto: ${formatDate(finish)}.` : 'CPM aplicado.',
  }),

  // --------------------------------------------------------------- WBS items
  itemCreated: (item: WorkItem, parent: WorkItem | undefined): Notice => ({
    title: `${KIND_LABEL[item.kind]} ${g(KIND_GENDER[item.kind], 'creado', 'creada')}`,
    message: `${q(item.name)} se agregó ${parent ? `dentro de ${q(parent.name)}` : 'en la raíz del proyecto'}. Complete sus datos en el editor.`,
  }),
  itemUpdated: (item: WorkItem): Notice => ({
    title: `${KIND_LABEL[item.kind]} ${g(KIND_GENDER[item.kind], 'actualizado', 'actualizada')}`,
    message: `Se guardaron los cambios de ${q(item.name)} y el cronograma se recalculó.`,
  }),
  itemDeleted: (item: WorkItem, nested: number, strategy: 'reject' | 'remove' | 'bridge'): Notice => ({
    title: `${KIND_LABEL[item.kind]} ${g(KIND_GENDER[item.kind], 'eliminado', 'eliminada')}`,
    message: [
      `Se eliminó ${q(item.name)}${nested > 0 ? ` junto con ${nested} elemento(s) contenidos` : ''}.`,
      strategy === 'bridge' ? 'Sus predecesoras quedaron conectadas con sus sucesoras.' : '',
      strategy === 'remove' ? 'Sus dependencias también se eliminaron.' : '',
    ].filter(Boolean).join(' '),
  }),
  confirmDeleteItem: (item: WorkItem, nested: number, assignments: number) => ({
    title: `¿Eliminar ${theKind(item.kind)} ${q(item.name)}?`,
    message: 'Esta acción no se puede deshacer.',
    details: [
      nested > 0 ? `También se eliminarán ${nested} elemento(s) contenidos.` : '',
      assignments > 0 ? `Se quitarán ${assignments} asignación(es) de responsables.` : '',
      'El cronograma se recalculará automáticamente.',
    ].filter(Boolean),
    confirmLabel: 'Eliminar',
  }),
  resolveDependencies: (item: WorkItem, nested: number, links: string[]) => ({
    title: `¿Eliminar ${theKind(item.kind)} ${q(item.name)}?`,
    message: `${nested > 0 ? `También se eliminarán ${nested} elemento(s) contenidos. ` : ''}`
      + `Tiene ${links.length} dependencia(s) con otras actividades; elija cómo resolverlas (RN-28):`,
    details: links,
  }),
  moveBlocked: { title: 'No se puede mover', message: 'El elemento ya está en el extremo de su contenedor.' } as Notice,

  // ------------------------------------------------------------ dependencies
  dependencyCreated: (text: string): Notice => ({ title: 'Dependencia creada', message: text }),
  dependencyUpdated: (text: string): Notice => ({ title: 'Dependencia actualizada', message: text }),
  dependencyDeleted: (text: string): Notice => ({ title: 'Dependencia eliminada', message: text }),
  confirmDeleteDependency: (text: string) => ({
    title: '¿Eliminar esta dependencia?',
    message: text,
    details: ['La sucesora podrá adelantarse y el cronograma se recalculará.'],
    confirmLabel: 'Eliminar dependencia',
  }),
  describeDependency: (d: Dependency, names: Map<string, string>) =>
    dependencyText(names.get(d.predecessor_id) ?? '?', names.get(d.successor_id) ?? '?', d.type, d.lag_value, d.lag_unit),

  // --------------------------------------------------------------- resources
  assignmentsSaved: (item: WorkItem, names: string[]): Notice => ({
    title: 'Responsables actualizados',
    message: names.length ? `${q(item.name)}: ${names.join(', ')}.` : `${q(item.name)} quedó sin responsables.`,
  }),

  // -------------------------------------------------------------------- team
  memberCreated: (name: string): Notice => ({ title: 'Integrante agregado', message: `${q(name)} ya puede asignarse a actividades.` }),
  memberUpdated: (name: string): Notice => ({ title: 'Integrante actualizado', message: `Se guardaron los datos de ${q(name)}.` }),
  memberDeleted: (name: string): Notice => ({ title: 'Integrante eliminado', message: `${q(name)} ya no forma parte del proyecto.` }),
  confirmDeleteMember: (name: string, assignments: number) => ({
    title: `¿Eliminar a ${q(name)} del proyecto?`,
    message: assignments > 0
      ? `Tiene ${assignments} actividad(es) asignada(s); esas asignaciones se quitarán.`
      : 'No tiene actividades asignadas.',
    details: ['Si solo dejará de participar temporalmente, puede marcarlo como inactivo en lugar de eliminarlo.'],
    confirmLabel: 'Eliminar integrante',
  }),
  roleCreated: (name: string): Notice => ({ title: 'Rol creado', message: `${q(name)} está disponible para los integrantes.` }),
  roleUpdated: (name: string): Notice => ({ title: 'Rol actualizado', message: `Se guardó el rol ${q(name)}.` }),
  roleDeleted: (name: string): Notice => ({ title: 'Rol eliminado', message: `Se eliminó el rol ${q(name)}.` }),
  confirmDeleteRole: (name: string, members: number) => ({
    title: `¿Eliminar el rol ${q(name)}?`,
    message: members > 0 ? `${members} integrante(s) tienen este rol y quedarán sin rol asignado.` : 'Ningún integrante usa este rol.',
    confirmLabel: 'Eliminar rol',
  }),

  // ---------------------------------------------------------------- calendar
  calendarSaved: { title: 'Calendario guardado', message: 'Las fechas del cronograma se recalcularon con la nueva jornada.' } as Notice,
}
