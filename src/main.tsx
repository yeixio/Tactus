import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { APP_NAME } from './brand'
import './ui/styles.css'

document.title = APP_NAME
createRoot(document.getElementById('root')!).render(<App />)
