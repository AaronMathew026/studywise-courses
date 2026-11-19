import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { IS_MAC } from '@shared/keymap'

document.documentElement.classList.add(IS_MAC ? 'is-mac' : 'is-win')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
