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

      {/* The one dynamic route every physical keychain points at. */}
      <Route path="/d/:id" element={<DoctorProfile />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="keychain/:id" element={<KeychainEditor />} />
      </Route>

      {/* Legacy / typo-friendly aliases — same profile, same data. */}
      <Route path="/doctor/:id" element={<DoctorProfile />} />
      <Route path="/D/:id" element={<DoctorProfile />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

