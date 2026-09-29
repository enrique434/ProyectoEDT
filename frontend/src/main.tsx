import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { DialogProvider } from './components/feedback/Dialogs'
import { NotificationProvider } from './components/feedback/Notifications'
import { UnsavedChangesProvider } from './components/feedback/UnsavedChanges'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <DialogProvider>
          <UnsavedChangesProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </UnsavedChangesProvider>
        </DialogProvider>
      </NotificationProvider>
    </QueryClientProvider>
  </StrictMode>,
)
