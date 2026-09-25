import { Routes, Route } from 'react-router-dom'
import DoctorProfile from './pages/DoctorProfile.jsx'
import AdminDashboard from './pages/AdminDashboard.jsx'
import KeychainEditor from './pages/KeychainEditor.jsx'
import Home from './pages/Home.jsx'
import NotFound from './pages/NotFound.jsx'
import AdminLayout from './components/AdminLayout.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />

      {/*
        Declared before the catch-all code route for readability. React Router
        ranks static segments above dynamic ones regardless of order, so
        /admin is never mistaken for a keychain code — but the reserved list
        in RESERVED_PATHS keeps that true if the routing ever changes.
      */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="keychain/:id" element={<KeychainEditor />} />
      </Route>

      {/*
        The one dynamic route every physical keychain points at:
        tap.eqova.in/<code>. The parameter is the keychain's random code,
        never its number — a sequential URL would let anyone claim or read
        any keychain by counting.
      */}
      <Route path="/:slug" element={<DoctorProfile />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
