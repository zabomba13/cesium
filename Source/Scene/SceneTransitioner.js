/*global define*/
define([
        '../Core/Cartesian3',
        '../Core/Cartographic',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/destroyObject',
        '../Core/DeveloperError',
        '../Core/EasingFunction',
        '../Core/Ellipsoid',
        '../Core/Math',
        '../Core/Matrix4',
        '../Core/ScreenSpaceEventHandler',
        '../Core/ScreenSpaceEventType',
        '../Core/Transforms',
        './Camera',
        './OrthographicFrustum',
        './PerspectiveFrustum',
        './SceneMode'
    ], function(
        Cartesian3,
        Cartographic,
        defaultValue,
        defined,
        destroyObject,
        DeveloperError,
        EasingFunction,
        Ellipsoid,
        CesiumMath,
        Matrix4,
        ScreenSpaceEventHandler,
        ScreenSpaceEventType,
        Transforms,
        Camera,
        OrthographicFrustum,
        PerspectiveFrustum,
        SceneMode) {
    "use strict";

    /**
     * @private
     */
    function SceneTransitioner(scene, ellipsoid) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(scene)) {
            throw new DeveloperError('scene is required.');
        }
        //>>includeEnd('debug');

        this._scene = scene;
        this._currentTweens = [];
        this._morphHandler = undefined;
        this._morphCancelled = false;
        this._completeMorph = undefined;
    }

    SceneTransitioner.prototype.completeMorph = function() {
        if (defined(this._completeMorph)) {
            this._completeMorph();
        }
    };

    SceneTransitioner.prototype.morphTo2D = function(duration, ellipsoid) {
        if (defined(this._completeMorph)) {
            this._completeMorph();
        }

        var scene = this._scene;
        this._previousMode = scene.mode;

        if (this._previousMode === SceneMode.SCENE2D || this._previousMode === SceneMode.MORPHING) {
            return;
        }
        this._scene.morphStart.raiseEvent(this, this._previousMode, SceneMode.SCENE2D, true);

        scene._mode = SceneMode.MORPHING;
        scene.camera._setTransform(Matrix4.IDENTITY);

        if (this._previousMode === SceneMode.COLUMBUS_VIEW) {
            morphFromColumbusViewTo2D(this, duration);
        } else {
            morphFrom3DTo2D(this, duration, ellipsoid);
        }

        if (duration === 0.0 && defined(this._completeMorph)) {
            this._completeMorph();
        }
    };

    var scratchToCVPosition = new Cartesian3();
    var scratchToCVDirection = new Cartesian3();
    var scratchToCVUp = new Cartesian3();
    var scratchToCVPosition2D = new Cartesian3();
    var scratchToCVDirection2D = new Cartesian3();
    var scratchToCVUp2D = new Cartesian3();
    var scratchToCVSurfacePosition = new Cartesian3();
    var scratchToCVCartographic = new Cartographic();
    var scratchToCVToENU = new Matrix4();
    var scratchToCVFrustum = new PerspectiveFrustum();
    var scratchToCVCamera = {
        position : undefined,
        direction : undefined,
        up : undefined,
        position2D : undefined,
        direction2D : undefined,
        up2D : undefined,
        frustum : undefined
    };

    SceneTransitioner.prototype.morphToColumbusView = function(duration, ellipsoid) {
        if (defined(this._completeMorph)) {
            this._completeMorph();
        }

        var scene = this._scene;
        this._previousMode = scene.mode;

        if (this._previousMode === SceneMode.COLUMBUS_VIEW || this._previousMode === SceneMode.MORPHING) {
            return;
        }
        this._scene.morphStart.raiseEvent(this, this._previousMode, SceneMode.COLUMBUS_VIEW, true);

        scene._mode = SceneMode.MORPHING;
        scene.camera._setTransform(Matrix4.IDENTITY);

        var camera = scene.camera;
        var position = scratchToCVPosition;
        var direction = scratchToCVDirection;
        var up = scratchToCVUp;

        if (this._previousMode === SceneMode.SCENE2D) {
            Cartesian3.clone(camera.position, position);
            Cartesian3.negate(Cartesian3.UNIT_Z, direction);
            Cartesian3.clone(Cartesian3.UNIT_Y, up);
        } else {
            Cartesian3.clone(camera.positionWC, position);
            Cartesian3.clone(camera.directionWC, direction);
            Cartesian3.clone(camera.upWC, up);

            var surfacePoint = ellipsoid.scaleToGeodeticSurface(position, scratchToCVSurfacePosition);
            var toENU = Transforms.eastNorthUpToFixedFrame(surfacePoint, ellipsoid, scratchToCVToENU);
            Matrix4.inverseTransformation(toENU, toENU);

            scene.mapProjection.project(ellipsoid.cartesianToCartographic(position, scratchToCVCartographic), position);
            Matrix4.multiplyByPointAsVector(toENU, direction, direction);
            Matrix4.multiplyByPointAsVector(toENU, up, up);
        }

        var frustum = scratchToCVFrustum;
        frustum.aspectRatio = scene.drawingBufferWidth / scene.drawingBufferHeight;
        frustum.fov = CesiumMath.toRadians(60.0);

        var cameraCV = scratchToCVCamera;
        cameraCV.position = position;
        cameraCV.direction = direction;
        cameraCV.up = up;
        cameraCV.frustum = frustum;

        var complete = completeColumbusViewCallback(cameraCV);
        createMorphHandler(this, complete);

        if (this._previousMode === SceneMode.SCENE2D) {
            morphFrom2DToColumbusView(this, duration, cameraCV, complete);
        } else {
            cameraCV.position2D = Matrix4.multiplyByPoint(Camera.TRANSFORM_2D, position, scratchToCVPosition2D);
            cameraCV.direction2D = Matrix4.multiplyByPointAsVector(Camera.TRANSFORM_2D, direction, scratchToCVDirection2D);
            cameraCV.up2D = Matrix4.multiplyByPointAsVector(Camera.TRANSFORM_2D, up, scratchToCVUp2D);
            morphFrom3DToColumbusView(this, duration, cameraCV, complete);
        }

        if (duration === 0.0 && defined(this._completeMorph)) {
            this._completeMorph();
        }
    };

    SceneTransitioner.prototype.morphTo3D = function(duration, ellipsoid) {
        if (defined(this._completeMorph)) {
            this._completeMorph();
        }

        var scene = this._scene;
        this._previousMode = scene.mode;

        if (this._previousMode === SceneMode.SCENE3D || this._previousMode === SceneMode.MORPHING) {
            return;
        }
        this._scene.morphStart.raiseEvent(this, this._previousMode, SceneMode.SCENE3D, true);

        scene._mode = SceneMode.MORPHING;
        scene.camera._setTransform(Matrix4.IDENTITY);

        if (this._previousMode === SceneMode.SCENE2D) {
            morphFrom2DTo3D(this, duration, ellipsoid);
        } else {
            var camera3D = getColumbusViewTo3DCamera(this, ellipsoid);
            var complete = complete3DCallback(camera3D);
            createMorphHandler(this, complete);

            morphFromColumbusViewTo3D(this, duration, camera3D, complete);
        }

        if (duration === 0.0 && defined(this._completeMorph)) {
            this._completeMorph();
        }
    };

    /**
     * Returns true if this object was destroyed; otherwise, false.
     * <br /><br />
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     *
     * @returns {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
     */
    SceneTransitioner.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @example
     * transitioner = transitioner && transitioner.destroy();
     */
    SceneTransitioner.prototype.destroy = function() {
        destroyMorphHandler(this);
        return destroyObject(this);
    };

    function createMorphHandler(transitioner, completeMorphFunction) {
        if (transitioner._scene.completeMorphOnUserInput) {
            transitioner._morphHandler = new ScreenSpaceEventHandler(transitioner._scene.canvas, false);

            var completeMorph = function() {
                transitioner._morphCancelled = true;
                completeMorphFunction(transitioner);
            };
            transitioner._completeMorph = completeMorph;
            transitioner._morphHandler.setInputAction(completeMorph, ScreenSpaceEventType.LEFT_DOWN);
            transitioner._morphHandler.setInputAction(completeMorph, ScreenSpaceEventType.MIDDLE_DOWN);
            transitioner._morphHandler.setInputAction(completeMorph, ScreenSpaceEventType.RIGHT_DOWN);
            transitioner._morphHandler.setInputAction(completeMorph, ScreenSpaceEventType.WHEEL);
        }
    }

    function destroyMorphHandler(transitioner) {
        var tweens = transitioner._currentTweens;
        for ( var i = 0; i < tweens.length; ++i) {
            tweens[i].cancelTween();
        }
        transitioner._currentTweens.length = 0;
        transitioner._morphHandler = transitioner._morphHandler && transitioner._morphHandler.destroy();
    }

    var scratchCVTo3DCartographic = new Cartographic();
    var scratchCVTo3DSurfacePoint = new Cartesian3();
    var scratchCVTo3DFromENU = new Matrix4();
    var scratchCVTo3DCamera = {
        position : new Cartesian3(),
        direction : new Cartesian3(),
        up : new Cartesian3(),
        frustum : undefined
    };

    function getColumbusViewTo3DCamera(transitioner, ellipsoid) {
        var scene = transitioner._scene;
        var camera = scene.camera;

        var camera3D = scratchCVTo3DCamera;
        var position = camera3D.position;
        var direction = camera3D.direction;
        var up = camera3D.up;

        var positionCarto = scene.mapProjection.unproject(camera.position, scratchCVTo3DCartographic);
        ellipsoid.cartographicToCartesian(positionCarto, position);
        var surfacePoint = ellipsoid.scaleToGeodeticSurface(position, scratchCVTo3DSurfacePoint);

        var fromENU = Transforms.eastNorthUpToFixedFrame(surfacePoint, ellipsoid, scratchCVTo3DFromENU);

        Matrix4.multiplyByPointAsVector(fromENU, camera.direction, direction);
        Matrix4.multiplyByPointAsVector(fromENU, camera.up, up);

        return camera3D;
    }

    var scratchCVTo3DStartPos = new Cartesian3();
    var scratchCVTo3DStartDir = new Cartesian3();
    var scratchCVTo3DStartUp = new Cartesian3();
    var scratchCVTo3DEndPos = new Cartesian3();
    var scratchCVTo3DEndDir = new Cartesian3();
    var scratchCVTo3DEndUp = new Cartesian3();

    function morphFromColumbusViewTo3D(transitioner, duration, endCamera, complete) {
        var scene = transitioner._scene;
        var camera = scene.camera;

        var startPos = Cartesian3.clone(camera.position, scratchCVTo3DStartPos);
        var startDir = Cartesian3.clone(camera.direction, scratchCVTo3DStartDir);
        var startUp = Cartesian3.clone(camera.up, scratchCVTo3DStartUp);

        var endPos = Matrix4.multiplyByPoint(Camera.TRANSFORM_2D_INVERSE, endCamera.position, scratchCVTo3DEndPos);
        var endDir = Matrix4.multiplyByPointAsVector(Camera.TRANSFORM_2D_INVERSE, endCamera.direction, scratchCVTo3DEndDir);
        var endUp = Matrix4.multiplyByPointAsVector(Camera.TRANSFORM_2D_INVERSE, endCamera.up, scratchCVTo3DEndUp);

        function update(value) {
            columbusViewMorph(startPos, endPos, value.time, camera.position);
            columbusViewMorph(startDir, endDir, value.time, camera.direction);
            columbusViewMorph(startUp, endUp, value.time, camera.up);
            Cartesian3.cross(camera.direction, camera.up, camera.right);
            Cartesian3.normalize(camera.right, camera.right);
        }

        var tween = scene.tweens.add({
            duration : duration,
            easingFunction : EasingFunction.QUARTIC_OUT,
            startObject : {
                time : 0.0
            },
            stopObject : {
                time : 1.0
            },
            update : update
        });
        transitioner._currentTweens.push(tween);

        addMorphTimeAnimations(transitioner, scene, 0.0, 1.0, duration, complete);
    }

    var scratch2DTo3DFrustum = new PerspectiveFrustum();

    function morphFrom2DTo3D(transitioner, duration, ellipsoid) {
        duration *= 0.5;

        var scene = transitioner._scene;
        var frustum = scratch2DTo3DFrustum;
        frustum.aspectRatio = scene.drawingBufferWidth / scene.drawingBufferHeight;
        frustum.fov = CesiumMath.toRadians(60.0);

        var camera3D = getColumbusViewTo3DCamera(transitioner, ellipsoid);
        camera3D.frustum = frustum;

        var complete = complete3DCallback(camera3D);
        createMorphHandler(transitioner, complete);

        morphOrthographicToPerspective(transitioner, duration, camera3D, function() {
            morphFromColumbusViewTo3D(transitioner, duration, camera3D, complete);
        });
    }

    function columbusViewMorph(startPosition, endPosition, time, result) {
        // Just linear for now.
        return Cartesian3.lerp(startPosition, endPosition, time, result);
    }

    function morphPerspectiveToOrthographic(transitioner, duration, endCamera, updateHeight, complete) {
        var scene = transitioner._scene;
        var camera = scene.camera;

        var startFOV = camera.frustum.fov;
        var endFOV = CesiumMath.RADIANS_PER_DEGREE * 0.5;
        var d = endCamera.position.z * Math.tan(startFOV * 0.5);
        camera.frustum.far = d / Math.tan(endFOV * 0.5) + 10000000.0;

        function update(value) {
            camera.frustum.fov = CesiumMath.lerp(startFOV, endFOV, value.time);
            var height = d / Math.tan(camera.frustum.fov * 0.5);
            updateHeight(camera, height);
        }
        var tween = scene.tweens.add({
            duration : duration,
            easingFunction : EasingFunction.QUARTIC_OUT,
            startObject : {
                time : 0.0
            },
            stopObject : {
                time : 1.0
            },
            update : update,
            complete : function() {
                camera.frustum = endCamera.frustum.clone();
                complete(transitioner);
            }
        });
        transitioner._currentTweens.push(tween);
    }

    var scratchCVTo2DStartPos = new Cartesian3();
    var scratchCVTo2DStartDir = new Cartesian3();
    var scratchCVTo2DStartUp = new Cartesian3();
    var scratchCVTo2DEndDir = new Cartesian3();
    var scratchCVTo2DEndUp = new Cartesian3();
    var scratchCVTo2DFrustum = new OrthographicFrustum();
    var scratchCVTo2DCamera = {
        position : undefined,
        direction : undefined,
        up : undefined,
        frustum : undefined
    };

    function morphFromColumbusViewTo2D(transitioner, duration) {
        duration *= 0.5;

        var scene = transitioner._scene;
        var camera = scene.camera;

        var position = Cartesian3.clone(camera.position, scratchCVTo2DStartPos);
        var startDir = Cartesian3.clone(camera.direction, scratchCVTo2DStartDir);
        var startUp = Cartesian3.clone(camera.up, scratchCVTo2DStartUp);

        var endDir = Cartesian3.negate(Cartesian3.UNIT_Z, scratchCVTo2DEndDir);
        var endUp = Cartesian3.clone(Cartesian3.UNIT_Y, scratchCVTo2DEndUp);

        var frustum = scratchCVTo2DFrustum;
        frustum.right = position.z * 0.5;
        frustum.left = -frustum.right;
        frustum.top = frustum.right * (scene.drawingBufferHeight / scene.drawingBufferWidth);
        frustum.bottom = -frustum.top;

        var camera2D = scratchCVTo2DCamera;
        camera2D.position = position;
        camera2D.direction = endDir;
        camera2D.up = endUp;
        camera2D.frustum = frustum;

        var complete = complete2DCallback(camera2D);
        createMorphHandler(transitioner, complete);

        function updateCV(value) {
            columbusViewMorph(startDir, endDir, value.time, camera.direction);
            columbusViewMorph(startUp, endUp, value.time, camera.up);
            Cartesian3.cross(camera.direction, camera.up, camera.right);
            Cartesian3.normalize(camera.right, camera.right);
        }

        function updateHeight(camera, height) {
            camera.position.z = height;
        }

        var tween = scene.tweens.add({
            duration : duration,
            easingFunction : EasingFunction.QUARTIC_OUT,
            startObject : {
                time : 0.0
            },
            stopObject : {
                time : 1.0
            },
            update : updateCV,
            complete : function() {
                morphPerspectiveToOrthographic(transitioner, duration, camera2D, updateHeight, complete);
            }
        });
        transitioner._currentTweens.push(tween);
    }

    var scratch3DTo2DCartographic = new Cartographic();
    var scratch3DTo2DCamera = {
        position : new Cartesian3(),
        direction : new Cartesian3(),
        up : new Cartesian3(),
        position2D : new Cartesian3(),
        direction2D : new Cartesian3(),
        up2D : new Cartesian3(),
        frustum : new OrthographicFrustum()
    };

    function morphFrom3DTo2D(transitioner, duration, ellipsoid) {
        duration *= 0.5;

        var scene = transitioner._scene;
        var camera2D = scratch3DTo2DCamera;

        ellipsoid.cartesianToCartographic(scene.camera.positionWC, scratch3DTo2DCartographic);
        var position = scene.mapProjection.project(scratch3DTo2DCartographic, camera2D.position);

        var frustum = camera2D.frustum;
        frustum.right = position.z * 0.5;
        frustum.left = -frustum.right;
        frustum.top = frustum.right * (scene.drawingBufferHeight / scene.drawingBufferWidth);
        frustum.bottom = -frustum.top;

        var direction = Cartesian3.negate(Cartesian3.UNIT_Z, camera2D.direction);
        var up = Cartesian3.clone(Cartesian3.UNIT_Y, camera2D.up);

        Matrix4.multiplyByPoint(Camera.TRANSFORM_2D, position, camera2D.position2D);
        Matrix4.multiplyByPointAsVector(Camera.TRANSFORM_2D, direction, camera2D.direction2D);
        Matrix4.multiplyByPointAsVector(Camera.TRANSFORM_2D, up, camera2D.up2D);

        function updateHeight(camera, height) {
            camera.position.x = height;
        }

        var complete = complete2DCallback(camera2D);
        createMorphHandler(transitioner, complete);

        function completeCallback() {
            morphPerspectiveToOrthographic(transitioner, duration, camera2D, updateHeight, complete);
        }
        morphFrom3DToColumbusView(transitioner, duration, camera2D, completeCallback);
    }

    function morphOrthographicToPerspective(transitioner, duration, cameraCV, complete) {
        var scene = transitioner._scene;
        var camera = scene.camera;

        var height = camera.frustum.right - camera.frustum.left;

        camera.frustum = cameraCV.frustum.clone();
        var endFOV = camera.frustum.fov;
        var startFOV = CesiumMath.RADIANS_PER_DEGREE * 0.5;
        var d = height * Math.tan(endFOV * 0.5);
        camera.frustum.far = d / Math.tan(startFOV * 0.5) + 10000000.0;
        camera.frustum.fov = startFOV;

        function update(value) {
            camera.frustum.fov = CesiumMath.lerp(startFOV, endFOV, value.time);
            camera.position.z = d / Math.tan(camera.frustum.fov * 0.5);
        }
        var tween = scene.tweens.add({
            duration : duration,
            easingFunction : EasingFunction.QUARTIC_OUT,
            startObject : {
                time : 0.0
            },
            stopObject : {
                time : 1.0
            },
            update : update,
            complete : function() {
                complete(transitioner);
            }
        });
        transitioner._currentTweens.push(tween);
    }

    function morphFrom2DToColumbusView(transitioner, duration, cameraCV, complete) {
        morphOrthographicToPerspective(transitioner, duration, cameraCV, complete);
    }

    var scratch3DToCVStartPos = new Cartesian3();
    var scratch3DToCVStartDir = new Cartesian3();
    var scratch3DToCVStartUp = new Cartesian3();
    var scratch3DToCVEndPos = new Cartesian3();
    var scratch3DToCVEndDir = new Cartesian3();
    var scratch3DToCVEndUp = new Cartesian3();

    function morphFrom3DToColumbusView(transitioner, duration, endCamera, complete) {
        var scene = transitioner._scene;
        var camera = scene.camera;

        var startPos = Cartesian3.clone(camera.position, scratch3DToCVStartPos);
        var startDir = Cartesian3.clone(camera.direction, scratch3DToCVStartDir);
        var startUp = Cartesian3.clone(camera.up, scratch3DToCVStartUp);

        var endPos = Cartesian3.clone(endCamera.position2D, scratch3DToCVEndPos);
        var endDir = Cartesian3.clone(endCamera.direction2D, scratch3DToCVEndDir);
        var endUp = Cartesian3.clone(endCamera.up2D, scratch3DToCVEndUp);

        function update(value) {
            columbusViewMorph(startPos, endPos, value.time, camera.position);
            columbusViewMorph(startDir, endDir, value.time, camera.direction);
            columbusViewMorph(startUp, endUp, value.time, camera.up);
            Cartesian3.cross(camera.direction, camera.up, camera.right);
            Cartesian3.normalize(camera.right, camera.right);
        }
        var tween = scene.tweens.add({
            duration : duration,
            easingFunction : EasingFunction.QUARTIC_OUT,
            startObject : {
                time : 0.0
            },
            stopObject : {
                time : 1.0
            },
            update : update
        });
        transitioner._currentTweens.push(tween);

        addMorphTimeAnimations(transitioner, scene, 1.0, 0.0, duration, complete);
    }

    function addMorphTimeAnimations(transitioner, scene, start, stop, duration, complete) {
        // Later, this will be linear and each object will adjust, if desired, in its vertex shader.
        var options = {
            object : scene,
            property : 'morphTime',
            startValue : start,
            stopValue : stop,
            duration : duration,
            easingFunction : EasingFunction.QUARTIC_OUT
        };

        if (defined(complete)) {
            options.complete = function() {
                complete(transitioner);
            };
        }

        var tween = scene.tweens.addProperty(options);
        transitioner._currentTweens.push(tween);
    }

    function complete3DCallback(camera3D) {
        return function(transitioner) {
            var scene = transitioner._scene;
            scene._mode = SceneMode.SCENE3D;
            scene.morphTime = SceneMode.getMorphTime(SceneMode.SCENE3D);

            destroyMorphHandler(transitioner);

            if (transitioner._previousMode !== SceneMode.MORPHING || transitioner._morphCancelled) {
                transitioner._morphCancelled = false;

                var camera = scene.camera;
                Cartesian3.clone(camera3D.position, camera.position);
                Cartesian3.clone(camera3D.direction, camera.direction);
                Cartesian3.clone(camera3D.up, camera.up);
                Cartesian3.cross(camera.direction, camera.up, camera.right);
                Cartesian3.normalize(camera.right, camera.right);
            }

            var wasMorphing = defined(transitioner._completeMorph);
            transitioner._completeMorph = undefined;
            scene.camera.update(scene.mode);
            transitioner._scene.morphComplete.raiseEvent(transitioner, transitioner._previousMode, SceneMode.SCENE3D, wasMorphing);
        };
    }

    function complete2DCallback(camera2D) {
        return function(transitioner) {
            var scene = transitioner._scene;

            scene._mode = SceneMode.SCENE2D;
            scene.morphTime = SceneMode.getMorphTime(SceneMode.SCENE2D);

            destroyMorphHandler(transitioner);

            var camera = scene.camera;
            Cartesian3.clone(camera2D.position, camera.position);
            Cartesian3.clone(camera2D.direction, camera.direction);
            Cartesian3.clone(camera2D.up, camera.up);
            Cartesian3.cross(camera.direction, camera.up, camera.right);
            Cartesian3.normalize(camera.right, camera.right);
            camera.frustum = camera2D.frustum.clone();

            var wasMorphing = defined(transitioner._completeMorph);
            transitioner._completeMorph = undefined;
            scene.camera.update(scene.mode);
            transitioner._scene.morphComplete.raiseEvent(transitioner, transitioner._previousMode, SceneMode.SCENE2D, wasMorphing);
        };
    }

    function completeColumbusViewCallback(cameraCV) {
        return function(transitioner) {
            var scene = transitioner._scene;
            scene._mode = SceneMode.COLUMBUS_VIEW;
            scene.morphTime = SceneMode.getMorphTime(SceneMode.COLUMBUS_VIEW);

            destroyMorphHandler(transitioner);
            scene.camera.frustum = cameraCV.frustum.clone();

            if (transitioner._previousModeMode !== SceneMode.MORPHING || transitioner._morphCancelled) {
                transitioner._morphCancelled = false;

                var camera = scene.camera;
                Cartesian3.clone(cameraCV.position, camera.position);
                Cartesian3.clone(cameraCV.direction, camera.direction);
                Cartesian3.clone(cameraCV.up, camera.up);
                Cartesian3.cross(camera.direction, camera.up, camera.right);
                Cartesian3.normalize(camera.right, camera.right);
            }

            var wasMorphing = defined(transitioner._completeMorph);
            transitioner._completeMorph = undefined;
            scene.camera.update(scene.mode);
            transitioner._scene.morphComplete.raiseEvent(transitioner, transitioner._previousMode, SceneMode.COLUMBUS_VIEW, wasMorphing);
        };
    }

    return SceneTransitioner;
});
