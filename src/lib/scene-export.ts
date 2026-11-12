import { DataTexture, DirectionalLight, Material, Mesh, Source, SpotLight, Texture, Vector3, type Scene } from 'three'

/** Export copies own their materials/textures; shared CAD geometry is never disposed. */
export async function exportSceneGlb(scene: Scene): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  scene.updateMatrixWorld(true)
  const copy = scene.clone(true)
  const materials = new Map<Material, Material>()
  const textures = new Map<Texture, Texture>()
  function materialFor(source: Material) {
    const cached = materials.get(source)
    if (cached) return cached
    const material = source.clone()
    materials.set(source, material)
    // GLTFExporter's metallic/roughness packing needs drawable images, not raw pixels.
    for (const [key, value] of Object.entries(material)) {
      if (!(value instanceof DataTexture)) continue
      let texture = textures.get(value)
      if (!texture) {
        const { data, width, height } = value.image
        if (!(data instanceof Uint8Array) || data.length !== width * height * 4) throw new Error('Unsupported procedural texture format.')
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Could not prepare texture images.')
        context.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
        texture = new Texture().copy(value)
        texture.source = new Source(canvas)
        textures.set(value, texture)
      }
      Object.assign(material, { [key]: texture })
    }
    return material
  }
  try {
    copy.traverse(object => {
      // Preview-only shader effects, such as sunbeams, have no glTF equivalent.
      if (object.userData.previewOnly) object.visible = false
      if (object instanceof Mesh) object.material = Array.isArray(object.material) ? object.material.map(materialFor) : materialFor(object.material)
      // glTF stores light direction as node rotation rather than a Three.js target.
      if (object instanceof DirectionalLight || object instanceof SpotLight) {
        object.target.updateWorldMatrix(true, false)
        object.lookAt(object.target.getWorldPosition(new Vector3()))
      }
    })
    copy.updateMatrixWorld(true)
    const result = await new GLTFExporter().parseAsync(copy, { binary: true, onlyVisible: true })
    if (!(result instanceof ArrayBuffer)) throw new Error('Could not create a binary glTF file.')
    return result
  } finally {
    materials.forEach(material => material.dispose())
    textures.forEach(texture => texture.dispose())
  }
}
