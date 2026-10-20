import { Route, Routes } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { LandingPage } from '../pages/LandingPage'
import { HowItWorksPage } from '../pages/HowItWorksPage'
import { SafetyPage } from '../pages/SafetyPage'
import { PlaceholderPage } from '../pages/PlaceholderPage'
import { NotFoundPage } from '../pages/NotFoundPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route path="how-it-works" element={<HowItWorksPage />} />
        <Route path="safety" element={<SafetyPage />} />
        <Route path="login" element={<PlaceholderPage title="Log in" />} />
        <Route path="register" element={<PlaceholderPage title="Create an account" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
