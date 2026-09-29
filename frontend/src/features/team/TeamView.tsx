import { useCallback, useState } from 'react'
import { api } from '../../api/client'
import { useProjectMutation } from '../../api/hooks'
import type { Member, MemberInput, Project, Role } from '../../api/types'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { Alert } from '../../components/feedback/Alert'
import { useDialogs } from '../../components/feedback/Dialogs'
import { useNotify } from '../../components/feedback/Notifications'
import { useGuardedClose } from '../../components/feedback/UnsavedChanges'
import { Field } from '../../components/form/Field'
import { describeError } from '../../lib/errors'
import { MSG } from '../../lib/messages'
import { errorList, first, rules, sameValues, useValidation, type Errors } from '../../lib/validation'

const EMPTY_MEMBER: MemberInput = { name: '', role_id: null, email: '', responsibility: '', hours_per_day: 8, active: true }

/** CU-05 members and CU-06 configurable roles. */
export function TeamView({ project }: { project: Project }) {
  const [editingMember, setEditingMember] = useState<Member | 'new' | null>(null)
  const [editingRole, setEditingRole] = useState<Role | 'new' | null>(null)
  const dialogs = useDialogs()
  const removeMember = useProjectMutation(project.id, (m: Member) => api.deleteMember(project.id, m.id), {
    success: (_, m) => MSG.memberDeleted(m.name),
    error: (m) => `No se pudo eliminar a “${m.name}”`,
  })
  const removeRole = useProjectMutation(project.id, (r: Role) => api.deleteRole(project.id, r.id), {
    success: (_, r) => MSG.roleDeleted(r.name),
    error: (r) => `No se pudo eliminar el rol “${r.name}”`,
  })
  const roles = new Map(project.roles.map((r) => [r.id, r.name]))
  const workload = new Map<string, number>()
  for (const item of project.items) {
    for (const a of item.assignments) workload.set(a.member_id, (workload.get(a.member_id) ?? 0) + 1)
  }

  const confirmRemoveMember = async (m: Member) => {
    if (await dialogs.confirm({ ...MSG.confirmDeleteMember(m.name, workload.get(m.id) ?? 0), tone: 'danger' })) removeMember.mutate(m)
  }
  const confirmRemoveRole = async (r: Role) => {
    const members = project.members.filter((m) => m.role_id === r.id).length
    if (await dialogs.confirm({ ...MSG.confirmDeleteRole(r.name, members), tone: members > 0 ? 'danger' : 'question' })) removeRole.mutate(r)
  }

  return (
    <div className="page-section two-columns">
      <section>
        <div className="section-header">
          <h2>Integrantes</h2>
          <Button variant="primary" size="sm" onClick={() => setEditingMember('new')}>+ Integrante</Button>
        </div>
        {project.members.length === 0 ? (
          <Alert tone="info" title="Aún no hay integrantes">Agregue a las personas del equipo para asignarlas como responsables de las actividades.</Alert>
        ) : (
          <table className="table">
            <thead><tr><th>Nombre</th><th>Rol</th><th>Responsabilidad</th><th className="num">h/día</th><th className="num">Actividades</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {project.members.map((m) => (
                <tr key={m.id} className={`clickable ${m.active ? '' : 'inactive'}`} onClick={() => setEditingMember(m)}>
                  <td><strong>{m.name}</strong>{m.email && <div className="muted small">{m.email}</div>}</td>
                  <td>{m.role_id ? roles.get(m.role_id) : <span className="muted">Sin rol</span>}</td>
                  <td>{m.responsibility || '—'}</td>
                  <td className="num">{m.hours_per_day}</td>
                  <td className="num">{workload.get(m.id) ?? 0}</td>
                  <td>{m.active ? <span className="badge badge-ok">Activo</span> : <span className="badge">Inactivo</span>}</td>
                  <td>
                    <button className="icon-btn danger" title={`Eliminar a ${m.name}`} aria-label={`Eliminar a ${m.name}`}
                      disabled={removeMember.isPending && removeMember.variables?.id === m.id}
                      onClick={(e) => { e.stopPropagation(); confirmRemoveMember(m) }}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <div className="section-header">
          <h2>Roles</h2>
          <Button size="sm" onClick={() => setEditingRole('new')}>+ Rol</Button>
        </div>
        <p className="muted small">Configurables por proyecto; se sugieren según la metodología.</p>
        {project.roles.length === 0 ? <Alert tone="info" compact>No hay roles definidos.</Alert> : (
          <ul className="role-list">
            {project.roles.map((r) => (
              <li key={r.id}>
                <button className="link" onClick={() => setEditingRole(r)}>{r.name}</button>
                {r.description && <span className="muted small"> — {r.description}</span>}
                <button className="icon-btn danger" title={`Eliminar el rol ${r.name}`} aria-label={`Eliminar el rol ${r.name}`}
                  disabled={removeRole.isPending && removeRole.variables?.id === r.id} onClick={() => confirmRemoveRole(r)}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editingMember && (
        <MemberDialog project={project} member={editingMember === 'new' ? null : editingMember} onClose={() => setEditingMember(null)} />
      )}
      {editingRole && (
        <RoleDialog project={project} role={editingRole === 'new' ? null : editingRole} onClose={() => setEditingRole(null)} />
      )}
    </div>
  )
}

const MEMBER_LABELS = { name: 'Nombre', email: 'Correo', hours_per_day: 'Horas disponibles por día' }

function validateMember(form: MemberInput): Errors {
  return {
    name: first(rules.required(form.name), rules.maxLength(form.name.trim(), 120)),
    email: rules.email(form.email),
    hours_per_day: rules.range(form.hours_per_day, 0.5, 24),
  }
}

function MemberDialog({ project, member, onClose }: { project: Project; member: Member | null; onClose: () => void }) {
  const [initial] = useState<MemberInput>(() => member
    ? { name: member.name, role_id: member.role_id, email: member.email, responsibility: member.responsibility,
        hours_per_day: member.hours_per_day, active: member.active }
    : EMPTY_MEMBER)
  const [form, setForm] = useState<MemberInput>(initial)
  const { errors, attempt, setServerErrors } = useValidation(form, validateMember)
  const notify = useNotify()
  const dirty = !sameValues(form, initial)
  const close = useGuardedClose(dirty, onClose)
  const save = useProjectMutation(project.id, (input: MemberInput) =>
    member ? api.updateMember(project.id, member.id, input) : api.createMember(project.id, input), {
    success: (_, input) => (member ? MSG.memberUpdated(input.name) : MSG.memberCreated(input.name)),
    error: member ? `No se pudieron guardar los datos de “${member.name}”` : 'No se pudo agregar el integrante',
  })
  const set = <K extends keyof MemberInput>(k: K, v: MemberInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!attempt()) return notify.warning(MSG.fixFields(errorList(validateMember(form), MEMBER_LABELS)))
    if (member && !dirty) {
      notify.info(MSG.noChanges)
      return onClose()
    }
    try {
      await save.mutateAsync({ ...form, name: form.name.trim(), email: form.email.trim() })
      onClose()
    } catch (error) {
      setServerErrors(describeError(error).fields)
    }
  }

  return (
    <Modal title={member ? `Editar integrante · ${member.name}` : 'Nuevo integrante'} onClose={close}
      footer={<>
        {dirty && <span className="dirty-badge">Cambios sin guardar</span>}
        <Button onClick={close} disabled={save.isPending}>Cancelar</Button>
        <Button variant="primary" loading={save.isPending} loadingText="Guardando…" onClick={submit}>
          {member ? 'Guardar cambios' : 'Agregar integrante'}
        </Button>
      </>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit() }} noValidate>
        <Field label="Nombre" required error={errors.name}>
          <input value={form.name} maxLength={120} autoFocus onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Rol" hint={project.roles.length === 0 ? 'Cree roles en la sección de la derecha.' : undefined}>
            <select value={form.role_id ?? ''} onChange={(e) => set('role_id', e.target.value || null)}>
              <option value="">— Sin rol —</option>
              {project.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Correo" error={errors.email}>
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
        </div>
        <Field label="Responsabilidad">
          <input value={form.responsibility} onChange={(e) => set('responsibility', e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Horas disponibles por día" required error={errors.hours_per_day} hint="Se usa para detectar sobreasignación.">
            <input type="number" min={0.5} max={24} step={0.5} value={form.hours_per_day}
              onChange={(e) => set('hours_per_day', Number(e.target.value))} />
          </Field>
          <label className="field check-field">
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Activo
          </label>
        </div>
        {member && !form.active && initial.active && (
          <Alert tone="warning" compact>Sus actividades asignadas mostrarán una alerta mientras esté inactivo.</Alert>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

function RoleDialog({ project, role, onClose }: { project: Project; role: Role | null; onClose: () => void }) {
  const [initial] = useState(() => ({ name: role?.name ?? '', description: role?.description ?? '' }))
  const [form, setForm] = useState(initial)
  const validate = useCallback((v: typeof initial): Errors => ({
    name: first(
      rules.required(v.name),
      rules.maxLength(v.name.trim(), 120),
      project.roles.some((r) => r.id !== role?.id && r.name.toLowerCase() === v.name.trim().toLowerCase())
        ? 'Ya existe un rol con ese nombre.' : undefined,
    ),
  }), [project.roles, role?.id])
  const { errors, attempt, setServerErrors } = useValidation(form, validate)
  const notify = useNotify()
  const dirty = !sameValues(form, initial)
  const close = useGuardedClose(dirty, onClose)
  const save = useProjectMutation(project.id, (v: typeof initial) =>
    role ? api.updateRole(project.id, role.id, v.name.trim(), v.description.trim())
      : api.createRole(project.id, v.name.trim(), v.description.trim()), {
    success: (_, v) => (role ? MSG.roleUpdated(v.name.trim()) : MSG.roleCreated(v.name.trim())),
    error: role ? `No se pudo guardar el rol “${role.name}”` : 'No se pudo crear el rol',
  })

  const submit = async () => {
    if (!attempt()) return notify.warning(MSG.fixFields(errorList(validate(form), { name: 'Nombre' })))
    if (role && !dirty) {
      notify.info(MSG.noChanges)
      return onClose()
    }
    try {
      await save.mutateAsync(form)
      onClose()
    } catch (error) {
      setServerErrors(describeError(error).fields)
    }
  }

  return (
    <Modal title={role ? `Editar rol · ${role.name}` : 'Nuevo rol'} onClose={close}
      footer={<>
        <Button onClick={close} disabled={save.isPending}>Cancelar</Button>
        <Button variant="primary" loading={save.isPending} loadingText="Guardando…" onClick={submit}>
          {role ? 'Guardar cambios' : 'Crear rol'}
        </Button>
      </>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit() }} noValidate>
        <Field label="Nombre" required error={errors.name}>
          <input value={form.name} autoFocus maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Descripción">
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
