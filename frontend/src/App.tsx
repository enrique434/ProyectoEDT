import { Link, Route, Routes } from 'react-router-dom'
import { ProjectListPage } from './pages/ProjectListPage'
import { ProjectPage } from './pages/ProjectPage'

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          ProyectoEDT
        </Link>
        <span className="topbar-sub">Planificación EDT · PERT · CPM · Gantt</span>
      </header>
      <Routes>
        <Route path="/" element={<ProjectListPage />} />
        <Route path="/projects/:projectId/*" element={<ProjectPage />} />
        <Route path="*" element={<p className="page">Página no encontrada.</p>} />
      </Routes>
    </div>
  )
}
