import { useContext } from 'react'
import { AppContext, type AppContextValue } from '../context/AppContext'

/** Acesso ao contexto global (fora do AppProvider lança erro de uso). */
export function useApp(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp deve ser usado dentro de <AppProvider>')
  }
  return context
}
