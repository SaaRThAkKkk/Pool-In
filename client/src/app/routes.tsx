import { Route, Routes } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { LandingPage } from '../pages/LandingPage'
import { HowItWorksPage } from '../pages/HowItWorksPage'
import { SafetyPage } from '../pages/SafetyPage'
import { DashboardPage } from '../pages/DashboardPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { LoginPage } from '../features/auth/LoginPage'
import { RegisterPage } from '../features/auth/RegisterPage'
import { RequireAuth } from '../features/auth/RequireAuth'
import { VerifyPhonePage } from '../features/auth/VerifyPhonePage'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route path="how-it-works" element={<HowItWorksPage />} />
        <Route path="safety" element={<SafetyPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        <Route element={<RequireAuth />}>
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="verify-phone" element={<VerifyPhonePage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
