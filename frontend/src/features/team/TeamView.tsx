import { useState } from 'react'
import { api } from '../../api/client'
import { useProjectMutation } from '../../api/hooks'
import type { Member, MemberInput, Project, Role } from '../../api/types'
import { Modal } from '../../components/Modal'

const EMPTY_MEMBER: MemberInput = { name: '', role_id: null, email: '', responsibility: '', hours_per_day: 8, active: true }

/** CU-05 members and CU-06 configurable roles. */
export function TeamView({ project }: { project: Project }) {
  const [editingMember, setEditingMember] = useState<Member | 'new' | null>(null)
  const [editingRole, setEditingRole] = useState<Role | 'new' | null>(null)
  const removeMember = useProjectMutation(project.id, (id: string) => api.deleteMember(project.id, id))
  const removeRole = useProjectMutation(project.id, (id: string) => api.deleteRole(project.id, id))
  const roles = new Map(project.roles.map((r) => [r.id, r.name]))
  const workload = new Map<string, number>()
  for (const item of project.items) {
    for (const a of item.assignments) workload.set(a.member_id, (workload.get(a.member_id) ?? 0) + 1)
  }

  return (
    <div className="page-section two-columns">
      <section>
        <div className="section-header">
          <h2>Integrantes</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setEditingMember('new')}>+ Integrante</button>
        </div>
        {project.members.length === 0 ? <p className="muted">Aún no hay integrantes.</p> : (
          <table className="table">
            <thead><tr><th>Nombre</th><th>Rol</th><th>Responsabilidad</th><th className="num">h/día</th><th className="num">Actividades</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {project.members.map((m) => (
                <tr key={m.id} className={`clickable ${m.active ? '' : 'inactive'}`} onClick={() => setEditingMember(m)}>
                  <td><strong>{m.name}</strong>{m.email && <div className="muted small">{m.email}</div>}</td>
                  <td>{m.role_id ? roles.get(m.role_id) : '—'}</td>
                  <td>{m.responsibility || '—'}</td>
                  <td className="num">{m.hours_per_day}</td>
                  <td className="num">{workload.get(m.id) ?? 0}</td>
                  <td>{m.active ? <span className="badge badge-ok">Activo</span> : <span className="badge">Inactivo</span>}</td>
                  <td>
                    <button className="icon-btn danger" title="Eliminar" onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`¿Eliminar a ${m.name}? Se quitarán sus asignaciones.`)) removeMember.mutate(m.id)
                    }}>🗑</button>
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
          <button className="btn btn-sm" onClick={() => setEditingRole('new')}>+ Rol</button>
        </div>
        <p className="muted small">Configurables por proyecto; se sugieren según la metodología.</p>
        <ul className="role-list">
          {project.roles.map((r) => (
            <li key={r.id}>
              <button className="link" onClick={() => setEditingRole(r)}>{r.name}</button>
              {r.description && <span className="muted small"> — {r.description}</span>}
              <button className="icon-btn danger" title="Eliminar rol" onClick={() => {
                if (confirm(`¿Eliminar el rol "${r.name}"? Los integrantes quedarán sin rol.`)) removeRole.mutate(r.id)
              }}>✕</button>
            </li>
          ))}
        </ul>
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

function MemberDialog({ project, member, onClose }: { project: Project; member: Member | null; onClose: () => void }) {
  const [form, setForm] = useState<MemberInput>(member ? { ...member } : EMPTY_MEMBER)
  const save = useProjectMutation(project.id, (input: MemberInput) =>
    member ? api.updateMember(project.id, member.id, input) : api.createMember(project.id, input))
  const set = <K extends keyof MemberInput>(k: K, v: MemberInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <Modal title={member ? 'Editar integrante' : 'Nuevo integrante'} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!form.name.trim() || save.isPending}
          onClick={() => save.mutate(form, { onSuccess: onClose })}>Guardar</button>
      </>}>
      <div className="form">
        <label className="field"><span>Nombre *</span><input value={form.name} autoFocus onChange={(e) => set('name', e.target.value)} /></label>
        <div className="grid-2">
          <label className="field"><span>Rol</span>
            <select value={form.role_id ?? ''} onChange={(e) => set('role_id', e.target.value || null)}>
              <option value="">— Sin rol —</option>
              {project.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Correo</span><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></label>
        </div>
        <label className="field"><span>Responsabilidad</span><input value={form.responsibility} onChange={(e) => set('responsibility', e.target.value)} /></label>
        <div className="grid-2">
          <label className="field"><span>Horas disponibles por día</span>
            <input type="number" min={0.5} max={24} step={0.5} value={form.hours_per_day} onChange={(e) => set('hours_per_day', Number(e.target.value))} />
          </label>
          <label className="field check-field">
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Activo
          </label>
        </div>
      </div>
    </Modal>
  )
}

function RoleDialog({ project, role, onClose }: { project: Project; role: Role | null; onClose: () => void }) {
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const save = useProjectMutation(project.id, () =>
    role ? api.updateRole(project.id, role.id, name, description) : api.createRole(project.id, name, description))
  return (
    <Modal title={role ? 'Editar rol' : 'Nuevo rol'} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>Guardar</button>
      </>}>
      <div className="form">
        <label className="field"><span>Nombre *</span><input value={name} autoFocus onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Descripción</span><input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      </div>
    </Modal>
  )
}
