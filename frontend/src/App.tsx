import { Link, Route, Routes } from 'react-router-dom'
import { Alert } from './components/feedback/Alert'
import { GuardedLink } from './components/feedback/UnsavedChanges'
import { ProjectListPage } from './pages/ProjectListPage'
import { ProjectPage } from './pages/ProjectPage'

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <GuardedLink to="/" className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          ProyectoEDT
        </GuardedLink>
        <span className="topbar-sub">Planificación EDT · PERT · CPM · Gantt</span>
      </header>
      <Routes>
        <Route path="/" element={<ProjectListPage />} />
        <Route path="/projects/:projectId/*" element={<ProjectPage />} />
        <Route path="*" element={
          <main className="page">
            <Alert tone="warning" title="Página no encontrada" action={<Link className="btn btn-sm" to="/">Ir a proyectos</Link>}>
              La dirección no corresponde a ninguna sección de la aplicación.
            </Alert>
          </main>
        } />
      </Routes>
    </div>
  )
}
