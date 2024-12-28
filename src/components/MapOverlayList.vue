<template>
    <div>
        <div class="image-overlay-list" :class="{ collapsed: !isExpanded }">
            <div class="list-header" @click="toggleExpanded">
                <span>Image Overlays</span>
                <span class="expand-icon">{{ isExpanded ? '▼' : '▶' }}</span>
            </div>
            <div class="list-container" v-show="isExpanded">
                <div v-for="image in availableImages"
                     :key="image.id"
                     class="list-item">
                    <label class="checkbox-label">
                        <input type="checkbox"
                               :checked="isImageSelected(image)"
                               @change="toggleImageOverlay(image)">
                        <div class="image-info">
                            <div class="image-title">{{ image.title || 'Untitled' }}</div>
                            <div class="image-description" v-if="image.description">{{ image.description }}</div>
                            <div class="image-date">{{ formatDate(image.created_at) }}</div>
                        </div>
                    </label>
                </div>
            </div>
        </div>

        <!-- Disambiguation Dialog -->
        <div v-if="showDisambiguation"
             class="disambiguation-dialog"
             :style="{ left: clickPosition.x + 'px', top: clickPosition.y + 'px' }">
            <div class="dialog-header">
                <h3>Overlapping Images</h3>
                <button class="close-button" @click="closeDisambiguation">&times;</button>
            </div>
            <div class="overlapping-images">
                <div v-for="image in clickedImages"
                     :key="image.id"
                     class="image-entry">
                    <div class="image-header">
                        <h4>{{ image.title || 'Untitled' }}</h4>
                        <input type="checkbox"
                               :checked="isImageSelected(image)"
                               @change="toggleImageOverlay(image)">
                    </div>
                    <div class="image-details">
                        <div v-if="image.description" class="description">{{ image.description }}</div>
                        <div class="date">{{ formatDate(image.created_at) }}</div>
                    </div>
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
    defined
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
            isExpanded: false,
            openSeaMapLayer: null
        }
    },
    watch: {
        isExpanded (newValue) {
            // Show/hide rectangles based on expanded state
            this.boundingRectangles.forEach(entity => {
                entity.show = newValue
            })
            this.viewer.scene.requestRender()
        }
    },
    mounted () {
        this.fetchAvailableImages()
        this.setupClickHandler()
        this.addOpenSeaMapOverlay()

        this.viewer.camera.moveEnd.addEventListener(() => {
            this.fetchAvailableImages()
        })
    },
    methods: {
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
                    `http://localhost:8000/images/bounds/?min_lat=${minLat}&min_lon=${minLon}&max_lat=${maxLat}&max_lon=${maxLon}`,
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
                this.updateBoundingRectangles()
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
                    show: this.isExpanded
                })
                this.boundingRectangles.set(image.id, entity)
            })
            this.viewer.scene.requestRender()
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
        }
    }
}
</script>

<style scoped>
.image-overlay-list {
    margin-left: 10px;
    background-color: rgba(40, 40, 40, 0.7);
    padding: 10px;
    border-radius: 5px;
    border: 1px solid #444;
    max-width: 300px;
    transition: all 0.3s ease;
}

.image-overlay-list.collapsed {
    padding-bottom: 4px;
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
.list-container::-webkit-scrollbar {
    width: 8px;
}

.list-container::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
}

.list-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 4px;
}

.list-container::-webkit-scrollbar-thumb:hover {
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
</style>
