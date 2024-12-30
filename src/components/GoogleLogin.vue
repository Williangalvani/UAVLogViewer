<template>
    <div class="login-container">
        <div id="login-section" v-show="!currentUser">
            <a @click="toggleLoginModal">
                <i class="fas fa-user"></i>
                Sign In
            </a>
        </div>
        <div id="user-info" v-show="currentUser">
            <a @click="toggleLoginModal">
                <img v-if="currentUser?.picture" :src="currentUser.picture" class="user-avatar" />
                <span class="user-name">{{ currentUser?.name || 'User' }}</span>
            </a>
        </div>

        <!-- Login Modal -->
        <div v-show="showLoginModal" class="login-modal">
            <div class="login-modal-content">
                <div v-show="!currentUser">
                    <h3>Sign In</h3>
                    <div id="g_id_signin"></div>
                </div>
                <div v-show="currentUser" class="user-details">
                    <img v-if="currentUser?.picture" :src="currentUser.picture" class="user-avatar-large" />
                    <div class="user-info">
                        <div class="user-name">{{ currentUser?.name || 'User' }}</div>
                        <div class="user-email">{{ currentUser?.email || '' }}</div>
                    </div>
                    <button class="logout-button" @click="logout">
                        <i class="fas fa-sign-out-alt"></i> Sign Out
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    name: 'GoogleLogin',
    data () {
        return {
            currentUser: null,
            showLoginModal: false,
            oauthConfig: {
                // eslint-disable-next-line camelcase
                client_id: '977629193181-809k8b8nm5rc2d63lohi9qacl5r34s8t.apps.googleusercontent.com'
            }
        }
    },
    mounted () {
        this.loadGoogleSignIn()
        this.checkLoginStatus()
    },
    methods: {
        loadGoogleSignIn () {
            const script = document.createElement('script')
            script.src = 'https://accounts.google.com/gsi/client'
            script.async = true
            script.defer = true
            document.head.appendChild(script)

            script.onload = () => {
                window.google.accounts.id.initialize({
                    // eslint-disable-next-line camelcase
                    client_id: this.oauthConfig.client_id,
                    callback: this.handleCredentialResponse
                })

                window.google.accounts.id.renderButton(
                    document.getElementById('g_id_signin'),
                    {
                        theme: 'outline',
                        size: 'large',
                        type: 'standard',
                        text: 'signin_with',
                        shape: 'rectangular',
                        // eslint-disable-next-line camelcase
                        logo_alignment: 'left'
                    }
                )
            }
        },

        async handleCredentialResponse (response) {
            try {
                console.log('Verifying token with credentials...')
                const verifyResult = await fetch('https://localhost:8000/auth/verify', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        token: response.credential
                    })
                })

                if (!verifyResult.ok) {
                    const error = await verifyResult.json()
                    throw new Error(error.detail || 'Failed to verify token')
                }

                const verifyData = await verifyResult.json()
                if (!verifyData.verified) {
                    throw new Error('Token verification failed')
                }

                // Use the server-verified user data instead of decoding the token
                this.currentUser = {
                    ...verifyData.user,
                    // Add picture from token payload if needed
                    picture: JSON.parse(atob(response.credential.split('.')[1])).picture,
                    verified: true
                }
                this.showLoginModal = false
                localStorage.setItem('user', JSON.stringify(this.currentUser))
                this.$emit('login', this.currentUser)
            } catch (error) {
                console.error('Login error:', error)
                this.currentUser = null
                localStorage.removeItem('user')
            }
        },

        toggleLoginModal () {
            this.showLoginModal = !this.showLoginModal
        },

        async checkLoginStatus () {
            try {
                const response = await fetch('https://localhost:8000/users/me', {
                    credentials: 'include'
                })

                if (response.ok) {
                    const userData = await response.json()
                    this.currentUser = {
                        ...userData,
                        verified: true
                    }
                    localStorage.setItem('user', JSON.stringify(this.currentUser))
                    this.$emit('login', this.currentUser)
                } else {
                    // Clear stored user if session is invalid
                    this.currentUser = null
                    localStorage.removeItem('user')
                }
            } catch (error) {
                console.error('Session check failed:', error)
                this.currentUser = null
                localStorage.removeItem('user')
            }
        },

        async logout () {
            if (this.currentUser?.email) {
                try {
                    await window.google?.accounts.id.revoke(this.currentUser.email, () => {
                        console.log('Google consent revoked')
                    })
                } catch (error) {
                    console.warn('Error revoking Google consent:', error)
                }
            }
            // Clear local state regardless of revoke success
            this.currentUser = null
            localStorage.removeItem('user')
            this.$emit('logout')
            this.showLoginModal = false
            // Reinitialize Google Sign-In
            window.google?.accounts.id.initialize({
                // eslint-disable-next-line camelcase
                client_id: this.oauthConfig.client_id,
                callback: this.handleCredentialResponse
            })
        }
    }
}
</script>

<style scoped>
.login-container {
    position: relative;
}

.login-container a {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: inherit;
    text-decoration: none;
    padding: 8px;
}

.login-container a:hover {
    background: rgba(255, 255, 255, 0.1);
}

.user-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
}

.user-avatar-large {
    width: 48px;
    height: 48px;
    border-radius: 50%;
}

.login-modal {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 2000;
    margin-top: 4px;
}

.login-modal-content {
    background: rgba(38, 38, 38, 0.95);
    padding: 20px;
    border-radius: 8px;
    border: 1px solid #444;
    min-width: 300px;
    color: #edffff;
}

.user-details {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
}

.user-info {
    text-align: center;
}

.user-name {
    font-weight: bold;
}

.user-email {
    font-size: 0.9em;
    color: #aaa;
}

.logout-button {
    background: none;
    border: 1px solid #666;
    color: #edffff;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.2s;
}

.logout-button:hover {
    background: rgba(255, 255, 255, 0.1);
}
</style>
