export const API_BASE_URL = 'https://mapper.galvanicloop.com/api'

// Helper function to build API URLs
export function buildApiUrl (path) {
    return `${API_BASE_URL}${path}`
}
