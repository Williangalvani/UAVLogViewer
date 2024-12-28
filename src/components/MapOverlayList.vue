<template>
    <div class="layer-picker-container">
        <!-- Layer Picker Dialog -->
        <div v-if="showLayerPicker" class="image-overlay-list cesium-baseLayerPicker-dropDown">
            <!-- Base Layers Section -->
            <div class="layer-section">
                <div class="layer-section-title">Base Maps</div>
                <div v-for="layer in baseLayers"
                     :key="layer.name"
                     class="layer-item"
                     @click="selectBaseLayer(layer)">
                    <img :src="layer.iconUrl" class="layer-icon" :alt="layer.name">
                    <div class="layer-info">
                        <div class="layer-name">{{ layer.name }}</div>
                        <div class="layer-description">{{ layer.tooltip }}</div>
                    </div>
                    <input type="radio"
                           :name="'base-layer'"
                           :checked="layer === selectedBaseLayer"
                           @change="selectBaseLayer(layer)">
                </div>
            </div>

            <!-- User Overlays Section -->
            <div class="layer-section">
                <div class="layer-section-title">Overlays</div>
                <div v-for="image in availableImages"
                     :key="image.id"
                     class="layer-item"
                     @mouseenter="highlightRectangle(image)"
                     @mouseleave="unhighlightRectangle(image)">
                    <div class="layer-info" @click="toggleImageOverlay(image)">
                        <div class="layer-name">{{ image.title || 'Untitled' }}</div>
                        <div class="layer-description">
                            {{ formatDate(image.created_at) }}
                        </div>
                    </div>
                    <div class="layer-actions">
                        <button class="action-button"
                                title="Center view"
                                @click.stop="centerOnImage(image)">
                            <i class="fas fa-crosshairs"></i>
                        </button>
                        <button class="action-button"
                                title="Show details"
                                @click.stop="showImageDetails(image)">
                            <i class="fas fa-info-circle"></i>
                        </button>
                        <input type="checkbox"
                               :checked="isImageSelected(image)"
                               @change="toggleImageOverlay(image)">
                    </div>
                </div>
            </div>

            <!-- Navigation Overlays -->
            <div class="layer-section">
                <div class="layer-section-title">Navigation</div>
                <div class="layer-item"
                     @click="showSeamarks = !showSeamarks; toggleSeamarks()">
                    <div class="layer-info">
                        <div class="layer-name">OpenSeaMap</div>
                        <div class="layer-description">Nautical navigation data</div>
                    </div>
                    <input type="checkbox"
                           v-model="showSeamarks"
                           @click.stop>
                </div>
            </div>
        </div>

        <!-- Disambiguation Dialog -->
        <div v-if="showDisambiguation" class="disambiguation-dialog" :style="disambiguationStyle">
            <div class="dialog-header">
                <h3>Overlapping Images</h3>
                <button class="close-button" @click="closeDisambiguation">&times;</button>
            </div>
            <div class="overlapping-images">
                <div v-for="image in clickedImages"
                     :key="image.id"
                     class="image-entry"
                     @mouseenter="highlightRectangle(image)"
                     @mouseleave="unhighlightRectangle(image)">
                    <div class="image-header">
                        <h4>{{ image.title || 'Untitled' }}</h4>
                        <input type="checkbox"
                               :checked="isImageSelected(image)"
                               @change="toggleImageOverlay(image)">
                    </div>
                    <div class="image-details">
                        <div class="description">{{ image.description || 'No description' }}</div>
                        <div class="date">{{ formatDate(image.created_at) }}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Image Details Modal -->
        <div v-if="showDetailsModal" class="image-details-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>{{ selectedImage?.title || 'Untitled' }}</h3>
                    <button class="close-button" @click="closeDetailsModal">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="date">Created: {{ formatDate(selectedImage?.created_at) }}</p>
                    <p class="description">{{ selectedImage?.description || 'No description available' }}</p>
                    <p class="coordinates">
                        Bounds:<br>
                        North: {{ selectedImage?.top.toFixed(6) }}°<br>
                        South: {{ selectedImage?.bottom.toFixed(6) }}°<br>
                        East: {{ selectedImage?.right.toFixed(6) }}°<br>
                        West: {{ selectedImage?.left.toFixed(6) }}°
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { DateTime } from 'luxon'
import {
    Rectangle,
    UrlTemplateImageryProvider,
    Color,
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    defined,
    IonImageryProvider,
    ImageryLayer,
    buildModuleUrl
} from 'cesium'

export default {
    name: 'MapOverlayList',
    props: {
        viewer: {
            type: Object,
            required: true
        }
    },
    data () {
        return {
            availableImages: [],
            selectedImages: new Set(),
            imageOverlayEntities: new Map(),
            boundingRectangles: new Map(),
            showDisambiguation: false,
            clickedImages: [],
            clickPosition: { x: 0, y: 0 },
            openSeaMapLayer: null,
            showSeamarks: false,
            selectedBaseLayer: null,
            showLayerPicker: false,
            showDetailsModal: false,
            selectedImage: null,
            baseLayers: [
                {
                    name: 'Sentinel-2',
                    iconUrl: buildModuleUrl('Widgets/Images/ImageryProviders/sentinel-2.png'),
                    tooltip: 'Sentinel-2 satellite imagery',
                    creationFunction: async () => {
                        const provider = await IonImageryProvider.fromAssetId(3954)
                        return new ImageryLayer(provider)
                    }
                },
                {
                    name: 'Bing Maps Aerial',
                    iconUrl: buildModuleUrl('Widgets/Images/ImageryProviders/bingAerial.png'),
                    tooltip: 'Bing Maps aerial imagery',
                    creationFunction: async () => {
                        const provider = await IonImageryProvider.fromAssetId(2)
                        return new ImageryLayer(provider)
                    }
                },
                {
                    name: 'OpenStreetMap',
                    iconUrl: buildModuleUrl('Widgets/Images/ImageryProviders/openStreetMap.png'),
                    tooltip: 'OpenStreetMap imagery',
                    creationFunction: () => {
                        const provider = new UrlTemplateImageryProvider({
                            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                            maximumLevel: 19
                        })
                        return new ImageryLayer(provider)
                    }
                },
                {
                    name: 'StatKart',
                    iconUrl: require('../assets/statkart.jpg').default,
                    tooltip: 'Statkart aerial imagery \nhttp://statkart.no/',
                    creationFunction: () => {
                        const provider = new UrlTemplateImageryProvider({
                            url: 'http://opencache.statkart.no/gatekeeper/gk/gk.open_gmaps?layers=topo4&zoom={z}&x={x}&y={y}',
                            credit: 'Map tiles by Statkart.'
                        })
                        return new ImageryLayer(provider)
                    }
                },
                {
                    name: 'MapTiler',
                    iconUrl: require('../assets/maptiler.png').default,
                    tooltip: 'Maptiler satellite imagery http://maptiler.com/',
                    creationFunction: () => {
                        const provider = new UrlTemplateImageryProvider({
                            url: 'https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=o3JREHNnXex8WSPPm2BU',
                            minimumLevel: 0,
                            maximumLevel: 20,
                            credit: 'https://www.maptiler.com/copyright'
                        })
                        return new ImageryLayer(provider)
                    }
                },
                {
                    name: 'Eniro',
                    iconUrl: require('../assets/eniro.png').default,
                    tooltip: 'Eniro aerial imagery \nhttp://map.eniro.com/',
                    creationFunction: () => {
                        const provider = new UrlTemplateImageryProvider({
                            url: '/eniro/{z}/{x}/{reverseY}.png',
                            credit: 'Map tiles by Eniro.'
                        })
                        return new ImageryLayer(provider)
                    }
                }
            ]
        }
    },
    mounted () {
        this.addLayerPickerButton()
        this.fetchAvailableImages()
        this.setupClickHandler()

        // Set Sentinel-2 as initial base layer
        this.selectBaseLayer(this.baseLayers[0])

        this.viewer.camera.moveEnd.addEventListener(() => {
            this.fetchAvailableImages()
        })

        // Close layer picker when clicking outside
        document.addEventListener('click', this.handleOutsideClick)
    },
    beforeDestroy () {
        document.removeEventListener('click', this.handleOutsideClick)
    },
    methods: {
        addLayerPickerButton () {
            const toolbar = document.getElementsByClassName('cesium-viewer-toolbar')[0]
            const wrapper = document.createElement('span')
            wrapper.classList.add('cesium-navigationHelpButton-wrapper')

            wrapper.innerHTML = `
                <button type="button"
                        id="cesium-layer-button"
                        class="cesium-button cesium-toolbar-button"
                        title="Base layers and overlays">
                    <i class="fas fa-layer-group"></i>
                </button>
            `.trim()

            toolbar.appendChild(wrapper)

            const button = document.getElementById('cesium-layer-button')
            button.addEventListener('click', this.toggleLayerPicker)
        },
        handleOutsideClick (event) {
            const picker = document.querySelector('.image-overlay-list')
            const button = document.getElementById('cesium-layer-button')
            if (this.showLayerPicker &&
                picker &&
                button &&
                !picker.contains(event.target) &&
                !button.contains(event.target)) {
                this.showLayerPicker = false
                // Remove all rectangles when closing
                this.boundingRectangles.forEach(entity => {
                    this.viewer.entities.remove(entity)
                })
                this.boundingRectangles.clear()
                this.viewer.scene.requestRender()
            }
        },
        async selectBaseLayer (layer) {
            // Remove current base layer if it exists
            if (this.viewer.scene.imageryLayers.length > 0) {
                this.viewer.scene.imageryLayers.remove(this.viewer.scene.imageryLayers.get(0))
            }

            // Create and add new base layer
            const newLayer = await layer.creationFunction()
            this.viewer.scene.imageryLayers.add(newLayer, 0)
            this.selectedBaseLayer = layer
            this.viewer.scene.requestRender()
        },

        toggleSeamarks () {
            if (this.showSeamarks) {
                this.addOpenSeaMapOverlay()
            } else if (this.openSeaMapLayer) {
                this.viewer.scene.imageryLayers.remove(this.openSeaMapLayer)
                this.openSeaMapLayer = null
            }
            this.viewer.scene.requestRender()
        },

        setupClickHandler () {
            const handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas)
            handler.setInputAction((click) => {
                const pickedObjects = this.viewer.scene.drillPick(click.position)
                if (!defined(pickedObjects)) return

                // Filter for our rectangle entities
                const clickedImages = pickedObjects
                    .filter(obj => obj.id && obj.id.imageData)
                    .map(obj => obj.id.imageData)

                if (clickedImages.length > 0) {
                    this.clickedImages = clickedImages
                    this.clickPosition = click.position
                    this.showDisambiguation = true
                }
            }, ScreenSpaceEventType.LEFT_CLICK)
        },

        async fetchAvailableImages () {
            try {
                const rectangle = this.viewer.camera.computeViewRectangle()
                const minLat = (rectangle.south * 180 / Math.PI)
                const maxLat = (rectangle.north * 180 / Math.PI)
                const minLon = (rectangle.west * 180 / Math.PI)
                const maxLon = (rectangle.east * 180 / Math.PI)

                const response = await fetch(
                    `http://localhost:8000/images/bounds/?min_lat=${minLat}&min_lon=${minLon}&max_lat=${maxLat}&max_lon=${maxLon}&include_partial=true`,
                    {
                        headers: {
                            accept: 'application/json'
                        }
                    }
                )

                if (!response.ok) {
                    throw new Error('Failed to fetch images')
                }

                this.availableImages = await response.json()
                if (this.showLayerPicker) {
                    this.updateBoundingRectangles()
                }
            } catch (error) {
                console.error('Error fetching images:', error)
            }
        },

        updateBoundingRectangles () {
            // Clear existing rectangles
            this.boundingRectangles.forEach(entity => {
                this.viewer.entities.remove(entity)
            })
            this.boundingRectangles.clear()

            // Add new rectangles
            this.availableImages.forEach(image => {
                const entity = this.viewer.entities.add({
                    rectangle: {
                        coordinates: Rectangle.fromDegrees(
                            image.left,
                            image.bottom,
                            image.right,
                            image.top
                        ),
                        material: Color.WHITE.withAlpha(0.2),
                        outline: true,
                        outlineColor: Color.WHITE
                    },
                    imageData: image,
                    show: this.showLayerPicker
                })
                // Add cursor style
                entity.cursor = 'pointer'
                this.boundingRectangles.set(image.id, entity)
            })
            this.viewer.scene.requestRender()
        },

        highlightRectangle (image) {
            const entity = this.boundingRectangles.get(image.id)
            if (entity) {
                entity.rectangle.material = Color.ORANGE.withAlpha(0.5)
                entity.rectangle.outlineColor = Color.YELLOW
                this.viewer.scene.requestRender()
            }
        },

        unhighlightRectangle (image) {
            const entity = this.boundingRectangles.get(image.id)
            if (entity) {
                entity.rectangle.material = Color.WHITE.withAlpha(0.2)
                entity.rectangle.outlineColor = Color.WHITE
                this.viewer.scene.requestRender()
            }
        },

        isImageSelected (image) {
            return this.selectedImages.has(image.id)
        },

        toggleImageOverlay (image) {
            if (this.isImageSelected(image)) {
                // Remove overlay
                this.selectedImages.delete(image.id)
                if (this.imageOverlayEntities.has(image.id)) {
                    this.viewer.scene.imageryLayers.remove(this.imageOverlayEntities.get(image.id))
                    this.imageOverlayEntities.delete(image.id)
                }
            } else {
                // Add overlay
                this.selectedImages.add(image.id)
                this.addImageOverlay(image)
            }
            this.viewer.scene.requestRender()
        },

        addImageOverlay (image) {
            if (this.imageOverlayEntities.has(image.id)) {
                this.viewer.scene.imageryLayers.remove(this.imageOverlayEntities.get(image.id))
            }

            // Calculate margin as 5% of the rectangle size
            const latSize = Math.abs(image.top - image.bottom)
            const lonSize = Math.abs(image.right - image.left)
            const margin = Math.max(latSize, lonSize) * 0.2

            const imageryProvider = new UrlTemplateImageryProvider({
                url: `http://localhost:8000/images/${image.id}/tiles/{z}/{x}/{y}.png`,
                rectangle: Rectangle.fromDegrees(
                    image.left - margin,
                    image.bottom - margin,
                    image.right + margin,
                    image.top + margin
                ),
                minimumLevel: 0,
                maximumLevel: 20
            })

            const layer = this.viewer.scene.imageryLayers.addImageryProvider(imageryProvider)
            this.imageOverlayEntities.set(image.id, layer)

            // Keep OpenSeaMap layer on top
            if (this.openSeaMapLayer) {
                this.viewer.scene.imageryLayers.raiseToTop(this.openSeaMapLayer)
                this.viewer.scene.requestRender()
            }
        },

        formatDate (dateString) {
            const date = DateTime.fromISO(dateString)
            return date.toLocaleString(DateTime.DATETIME_SHORT)
        },

        closeDisambiguation () {
            this.showDisambiguation = false
            this.clickedImages = []
            // Update rectangle visibility
            this.boundingRectangles.forEach(entity => {
                entity.show = this.showLayerPicker
            })
            this.viewer.scene.requestRender()
        },

        toggleExpanded () {
            this.isExpanded = !this.isExpanded
            this.viewer.scene.requestRender()
        },

        addOpenSeaMapOverlay () {
            const provider = new UrlTemplateImageryProvider({
                url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
                minimumLevel: 0,
                maximumLevel: 18
            })
            this.openSeaMapLayer = this.viewer.scene.imageryLayers.addImageryProvider(provider)
            this.viewer.scene.imageryLayers.raiseToTop(this.openSeaMapLayer)
            this.viewer.scene.requestRender()
        },

        toggleLayerPicker () {
            this.showLayerPicker = !this.showLayerPicker
            if (this.showLayerPicker) {
                this.updateBoundingRectangles()
            } else {
                // Remove all rectangles when closing
                this.boundingRectangles.forEach(entity => {
                    this.viewer.entities.remove(entity)
                })
                this.boundingRectangles.clear()
            }
            this.viewer.scene.requestRender()
        },

        centerOnImage (image) {
            const rectangle = Rectangle.fromDegrees(
                image.left,
                image.bottom,
                image.right,
                image.top
            )

            // Use current camera height as maximum height
            const currentHeight = this.viewer.camera.positionCartographic.height

            this.viewer.camera.flyTo({
                destination: rectangle,
                duration: 1.5,
                maximumHeight: currentHeight
            })
        },

        showImageDetails (image) {
            this.selectedImage = image
            this.showDetailsModal = true
        },

        closeDetailsModal () {
            this.showDetailsModal = false
        }
    },
    computed: {
        disambiguationStyle () {
            if (!this.clickPosition) return {}

            return {
                left: `${this.clickPosition.x}px`,
                top: `${this.clickPosition.y}px`
            }
        }
    }
}
</script>

<style scoped>
.layer-picker-container {
    display: contents;
}

#layerPickerButton {
    display: inline-block;
    position: relative;
    margin: 0;
}

.image-overlay-list {
    position: fixed;
    top: 44px;
    right: 5px;
    background-color: rgba(38, 38, 38, 0.95);
    padding: 10px;
    margin: 20px;
    border-radius: 5px;
    border: 1px solid #444;
    max-width: 300px;
    max-height: calc(100vh - 50px);
    overflow-y: auto;
    z-index: 1000;
}

.cesium-baseLayerPicker-dropDown {
    box-sizing: content-box;
    padding: 5px;
    top: 130px;
    border-radius: 5px;
    transform-origin: center top;
    visibility: visible;
    opacity: 1;
}

.layer-section {
    margin-bottom: 12px;
}

.layer-section-title {
    color: #edffff;
    font-size: 0.9em;
    font-weight: bold;
    padding: 4px 0;
    border-bottom: 1px solid #555;
    margin-bottom: 8px;
}

.layer-item {
    display: flex;
    align-items: center;
    padding: 4px 0;
    cursor: pointer;
    color: #edffff;
}

.layer-item:hover {
    background-color: rgba(255, 255, 255, 0.1);
}

.layer-icon {
    width: 24px;
    height: 24px;
    margin-right: 8px;
    border: 1px solid #555;
}

.layer-info {
    flex: 1;
}

.layer-name {
    font-size: 0.9em;
}

.layer-description {
    font-size: 0.8em;
    color: #aaa;
}

.list-header {
    color: #edffff;
    font-weight: bold;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #555;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    user-select: none;
}

.expand-icon {
    font-size: 12px;
    margin-left: 8px;
}

.list-container {
    max-height: 200px;
    overflow-y: auto;
    transition: max-height 0.3s ease;
}

.list-item {
    padding: 4px 0;
    color: #edffff;
    cursor: pointer;
}

.list-item:hover {
    background-color: rgba(255, 255, 255, 0.1);
}

.checkbox-label {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
    margin: 0;
    padding: 4px 0;
}

.checkbox-label input[type="checkbox"] {
    cursor: pointer;
}

.image-info {
    flex: 1;
    min-width: 0;
}

.image-title {
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.image-description {
    font-size: 0.9em;
    color: #aaa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.image-date {
    font-size: 0.8em;
    color: #888;
}

/* Scrollbar styling */
.image-overlay-list::-webkit-scrollbar {
    width: 8px;
}

.image-overlay-list::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
}

.image-overlay-list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 4px;
}

.image-overlay-list::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.4);
}

.disambiguation-dialog {
    position: fixed;
    background: rgba(40, 40, 40, 0.95);
    border: 1px solid #444;
    border-radius: 4px;
    padding: 12px;
    min-width: 250px;
    max-width: 400px;
    color: #edffff;
    z-index: 1000;
}

.dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.dialog-header h3 {
    margin: 0;
    font-size: 16px;
}

.close-button {
    background: none;
    border: none;
    color: #edffff;
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
}

.overlapping-images {
    max-height: 300px;
    overflow-y: auto;
}

.image-entry {
    padding: 8px;
    border-bottom: 1px solid #555;
}

.image-entry:last-child {
    border-bottom: none;
}

.image-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.image-header h4 {
    margin: 0;
    font-size: 14px;
}

.image-details {
    margin-top: 4px;
    font-size: 12px;
}

.description {
    color: #aaa;
    margin-bottom: 4px;
}

.date {
    color: #888;
}

.layer-actions {
    display: flex;
    align-items: center;
    gap: 4px;
}

.action-button {
    background: none;
    border: none;
    color: #edffff;
    padding: 4px;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.2s;
}

.action-button:hover {
    opacity: 1;
}

.image-details-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
}

.modal-content {
    background: rgba(38, 38, 38, 0.95);
    padding: 20px;
    border-radius: 8px;
    border: 1px solid #444;
    width: 400px;
    color: #edffff;
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.modal-header h3 {
    margin: 0;
}

.modal-header .close-button {
    background: none;
    border: none;
    color: #edffff;
    font-size: 24px;
    cursor: pointer;
    padding: 0 4px;
    opacity: 0.7;
    transition: opacity 0.2s;
}

.modal-header .close-button:hover {
    opacity: 1;
}

.modal-body {
    padding: 0;
}

.modal-body p {
    margin: 15px 0;
    line-height: 1.4;
}

.modal-body .date {
    color: #888;
    font-size: 0.9em;
}

.modal-body .coordinates {
    font-family: monospace;
    background: rgba(0, 0, 0, 0.2);
    padding: 10px;
    border-radius: 4px;
    margin-top: 15px;
    line-height: 1.6;
}
</style>
