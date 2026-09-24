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
        The one dynamic route every physical keychain points at. The parameter
        is the keychain's random code, never its number — /d/1 resolving would
        defeat the point of the code.
      */}
      <Route path="/d/:slug" element={<DoctorProfile />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="keychain/:id" element={<KeychainEditor />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
