import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { useMusicStore } from "@/stores/music-store";
import { useCatalogStore } from "@/stores/catalog-store";

export function SettingsTab() {
  const cacheMode = useMusicStore((s) => s.cacheMode);
  const setCacheMode = useMusicStore((s) => s.setCacheMode);
  const similarShuffle = useMusicStore((s) => s.similarShuffle);
  const setSimilarShuffle = useMusicStore((s) => s.setSimilarShuffle);
  const exportJson = useCatalogStore((s) => s.exportJson);
  const importJson = useCatalogStore((s) => s.importJson);
  const saveDeepseekKey = useCatalogStore((s) => s.saveDeepseekKey);
  const hasDeepseekKey = useCatalogStore((s) => s.hasDeepseekKey);
  const fileRef = useRef<HTMLInputElement>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [songCount, setSongCount] = useState("5");
  const sleep = useMusicStore((s) => s.sleep);
  const startSleepMinutes = useMusicStore((s) => s.startSleepMinutes);
  const startSleepAfterQueue = useMusicStore((s) => s.startSleepAfterQueue);
  const startSleepAfterCount = useMusicStore((s) => s.startSleepAfterCount);
  const cancelSleep = useMusicStore((s) => s.cancelSleep);

  return (
    <>
      <div className="section-title">播放</div>
      <div className="cache-setting">
        <label>
          <input
            type="checkbox"
            checked={similarShuffle}
            onChange={(e) => setSimilarShuffle(e.target.checked)}
          />
          <span>同类随机</span>
        </label>
        <p>仅随机播放时生效。打开后相同歌手、性别各加 4 分，有共同风格标签或相同语言各加 3 分；关闭则在当前播放列表里均匀随机。</p>
      </div>

      <div className="section-title">定时关闭</div>
      <div className="cache-setting">
        <p className="sleep-hint">到点后暂停，不再自动切下一首。不退出应用。</p>
        <div className="catalog-actions">
          {[15, 30, 60, 90].map((minutes) => (
            <button key={minutes} className="ghost" onClick={() => startSleepMinutes(minutes)}>
              {minutes} 分钟
            </button>
          ))}
          <button className="ghost" onClick={() => startSleepAfterQueue()}>
            播完列表
          </button>
        </div>
        <div className="key-row">
          <input
            inputMode="numeric"
            value={songCount}
            onChange={(e) => setSongCount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="首数"
          />
          <button
            className="ghost"
            onClick={() => startSleepAfterCount(Number(songCount) || 1)}
          >
            播完这么多首
          </button>
        </div>
        {sleep.type !== "off" ? (
          <button className="ghost" onClick={() => cancelSleep()}>
            取消定时
          </button>
        ) : null}
      </div>

      <div className="section-title">缓存</div>
      <div className="cache-setting">
        <label>
          <input
            type="checkbox"
            checked={cacheMode === "after_play"}
            onChange={(e) => setCacheMode(e.target.checked ? "after_play" : "off")}
          />
          <span>播完后缓存到本机</span>
        </label>
        <p>开启后整首播完才下载，不占首播速度；需足够磁盘空间</p>
      </div>

      <div className="section-title">分类数据</div>
      <div className="cache-setting">
        <div className="field-label">DeepSeek API Key</div>
        <div className="key-row">
          <input
            type="password"
            placeholder={hasDeepseekKey ? "已保存 DeepSeek Key，可覆盖" : "DeepSeek API Key"}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
          />
          <button className="ghost" onClick={() => void saveDeepseekKey(keyDraft).then(() => setKeyDraft(""))}>
            保存
          </button>
        </div>
        <div className="catalog-actions">
          <button className="ghost" onClick={() => exportJson()}>
            <Download size={14} /> 导出
          </button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> 导入
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void file.text().then((text) => importJson(text));
          }}
        />
      </div>
    </>
  );
}
