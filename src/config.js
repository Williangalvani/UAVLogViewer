const isDevelopment = process.env.NODE_ENV === 'development'

export const API_BASE_URL = isDevelopment
    ? 'https://localhost:8000/api'
    : 'https://mapper.galvanicloop.com/api'

// Helper function to build API URLs
export function buildApiUrl (path) {
    return `${API_BASE_URL}${path}`
}
