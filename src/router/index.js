import Vue from 'vue'
import Router from 'vue-router'
// import HelloWorld from '@/components/HelloWorld'
import Home from '../../src/components/Home.vue'
import PlotlyPopup from '../../src/components/PlotlyPopup.vue'

Vue.use(Router)

export default new Router({
    mode: 'history',
    routes: [
        {
            path: '/',
            name: 'Home',
            component: Home
        },
        {
            path: '/plot',
            name: 'Plot',
            component: PlotlyPopup
        },
        {
            path: '/v/:id',
            name: 'View',
            component: Home
        },
        {
            path: '/oauth2callback',
            name: 'OAuth2Callback',
            component: Home
        }
    ]
})
