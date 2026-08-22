import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { LensProvider } from './context/LensContext';
import { RequireAuth, RequireAdmin } from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import OfflineBanner from './components/OfflineBanner';

import Login from './pages/Login';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';
import Today from './pages/Today';
import Day from './pages/Day';
import Item from './pages/Item';
import Archive from './pages/Archive';
import MonthRevision from './pages/MonthRevision';
import Practice from './pages/Practice';
import Banks from './pages/Banks';
import Revision from './pages/Revision';
import Mistakes from './pages/Mistakes';
import Bookmarks from './pages/Bookmarks';
import Progress from './pages/Progress';
import Search from './pages/Search';
import Topics from './pages/Topics';
import Topic from './pages/Topic';
import Profile from './pages/Profile';
import NotFound from './pages/NotFound';

import AdminDashboard from './pages/admin/AdminDashboard';
import AdminQueue from './pages/admin/AdminQueue';
import AdminEditions from './pages/admin/AdminEditions';
import AdminDays from './pages/admin/AdminDays';
import AdminItemEditor from './pages/admin/AdminItemEditor';
import AdminFlags from './pages/admin/AdminFlags';
import AdminRuns from './pages/admin/AdminRuns';
import AdminStudents from './pages/admin/AdminStudents';
import AdminCorrections from './pages/admin/AdminCorrections';

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <LensProvider>
            <div className="min-h-screen bg-slate-50">
              <Navbar />
              <OfflineBanner />
              <main className="mx-auto max-w-5xl px-4 py-6">
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="/reset/:token" element={<ResetPassword />} />

                  <Route element={<RequireAuth />}>
                    <Route path="/" element={<Today />} />
                    <Route path="/day/:date" element={<Day />} />
                    <Route path="/item/:id" element={<Item />} />
                    <Route path="/archive" element={<Archive />} />
                    <Route path="/month/:month" element={<MonthRevision />} />
                    <Route path="/practice" element={<Practice />} />
                    <Route path="/banks" element={<Banks />} />
                    <Route path="/banks/:bank" element={<Banks />} />
                    <Route path="/revision" element={<Revision />} />
                    <Route path="/mistakes" element={<Mistakes />} />
                    <Route path="/saved" element={<Bookmarks />} />
                    <Route path="/progress" element={<Progress />} />
                    <Route path="/search" element={<Search />} />
                    <Route path="/topics" element={<Topics />} />
                    <Route path="/topics/:slug" element={<Topic />} />
                    <Route path="/profile" element={<Profile />} />
                  </Route>

                  <Route element={<RequireAdmin />}>
                    <Route path="/admin" element={<AdminDashboard />} />
                    <Route path="/admin/queue" element={<AdminQueue />} />
                    <Route path="/admin/editions" element={<AdminEditions />} />
                    <Route path="/admin/editions/:id" element={<AdminEditions />} />
                    <Route path="/admin/days" element={<AdminDays />} />
                    <Route path="/admin/days/:dayId" element={<AdminItemEditor />} />
                    <Route path="/admin/flags" element={<AdminFlags />} />
                    <Route path="/admin/runs" element={<AdminRuns />} />
                    <Route path="/admin/students" element={<AdminStudents />} />
                    <Route path="/admin/corrections" element={<AdminCorrections />} />
                  </Route>

                  <Route path="/index.html" element={<Navigate to="/" replace />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </main>
            </div>
          </LensProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
