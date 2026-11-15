# ForgeaX 音频要点（0.4.19 实测，供 游戏音效制作skill 引用）

来源：游戏仓库内 `skills/forgeax-engine-audio/SKILL.md`，以及 `node_modules/.pnpm/@forgeax+engine@<ver>*/node_modules/@forgeax/engine/node_modules/@forgeax/engine-audio{,-webaudio}/{README.md,src/}`。换引擎版本后，先按下面的「自查命令」核对一遍。

## 归属
- 游戏逻辑拥有 `AudioSource`（ECS 组件），Host 拥有 `AudioContext`。
- Worker 里只产生意图批次，不能出现任何 Web Audio 对象，DOM 也不进 Worker。
- 生成的 bootstrap（devkit）已经装好 `audioPlugin()`，在 Worker 模式下通过 `execution.createHostAudio` 用 `createHostAudioConsumer()` 播放。游戏**不需要**自己装 `webAudioPlugin`。
- frontend 插件可以拿到 `ctx.gameHost.audio`，它就是 Host 的 `WebAudioEngine`（getter，consumer 重建后会换对象）。

## 片段导入
- `<file>.wav.meta.json` 的写法：
  ```json
  { "schemaVersion": "1.0.0", "kind": "external-asset-package", "importer": "audio", "source": "<file>.wav",
    "importSettings": { "playback": "buffer" },
    "subAssets": [{ "guid": "<uuid>", "sourceIndex": 0, "kind": "audio", "sourceKey": "audio:audio" }] }
  ```
- importer 接受 `.wav/.mp3/.ogg/.flac`。`subAssets` 必须恰好一条，`kind` 为 `audio`，否则报 `audio-subasset-topology`。
- `playback: "stream"` 只支持 PCM16 WAV，适合长 BGM。短音效一律用 `buffer`。
- 运行时加载：`ctx.assets.load(guid, 'audio')`，用完 `assets.release(handle)`。解码在 Host 端做，Worker 只传字节。

## 播放一次性音效
- `world.spawn({ component: AudioSource, data: { clip, playing: true, volume, playbackRate, spatialBlend: 0, bus: 'sfx' } })`，播完 `despawn`。
- `playing` 从 false 变为 true 才会播放。复用同一个实体重播，必须先把 `playing` 设回 false。所以每播一次就 spawn 一个新实体最简单。
- `playbackRate` 同时改变音高，可以拿来做随机变调。
- 默认总线：`master`（根）→ `sfx` 和 `music`。`AudioSource.bus` 的默认值是 `'sfx'`。
- 主音量：`WebAudioEngine.setBusVolume('master', v)`。在 context 创建之前设置也会被保留。

## 状态与诊断
- Host 状态：`engine.getState()` 返回 `{ contextState, activeSourceCount, lastError, streaming }`；另有 `engine.getActiveSourceCount()`。
- 首次手势之前 `contextState` 是 `suspended`，这是正常的。bootstrap 会在第一次 click 或 keydown 时 resume。
- 「听不到声音」按这个顺序查：触发边沿确实发生 → clip 有效 → Host contextState 和 lastError → 实体寿命 → 总线、静音、音量。
- 只有事件计数，或者 console 0 错误，**不能证明**声音真的输出了。至少还要看 Host 的 activeSourceCount 峰值大于 0。

## 自查命令（换版本时）
```bash
E=$(ls -d node_modules/.pnpm/@forgeax+engine@*/node_modules/@forgeax/engine/node_modules/@forgeax | head -1)
sed -n 140,185p $E/engine-audio-webaudio/src/audio-importer.ts      # meta / sourceKey
sed -n 10,45p  $E/engine-audio/src/components.ts                   # AudioSource 字段
grep -n "id: '" $E/engine-audio/src/audio-buses.ts                  # 默认总线
grep -n "createHostAudio\|get audio()" $E/engine-devkit/dist/*.mjs | head   # bootstrap 是否自带 Host 音频
grep -n "setBusVolume\|getState\|getActiveSourceCount" $E/engine-audio-webaudio/src/web-audio-engine.ts
```
