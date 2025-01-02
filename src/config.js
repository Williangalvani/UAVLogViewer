const isDevelopment = process.env.NODE_ENV === 'development'

// Base path for the application (empty in dev, /logviewer in prod)
export const PUBLIC_PATH = isDevelopment ? '' : '/logviewer'

// API URLs
export const API_BASE_URL = isDevelopment
    ? 'http://localhost:8000/api'
    : 'https://mapper.galvanicloop.com/api'

// Helper function to build API URLs
export function buildApiUrl (path) {
    return `${API_BASE_URL}${path}`
}

// Helper function to build public URLs
export function buildPublicUrl (path) {
    return `${PUBLIC_PATH}${path}`
}
