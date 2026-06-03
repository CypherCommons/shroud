import BackgroundTasks
import Foundation
import React
import UserNotifications

/// Bridges BGTaskScheduler to the JS background scan task.
///
/// Flow: a BGTask fires → `onBackgroundScanStart {taskId, timeBudgetMs, reason}`
/// is emitted to JS (retrying until the bundle has loaded and a listener is
/// attached — cold background launches load JS asynchronously) → JS runs the
/// scan and calls `finish(taskId, success)` → `setTaskCompleted`. A watchdog
/// force-completes the task if JS never answers, since iOS terminates apps
/// that leave BGTasks dangling.
///
/// IMPORTANT: AppDelegate creates a pre-bridge instance for registerBGTasks(),
/// and React Native later instantiates its own bridge-attached one (which
/// overwrites `instance` in init, same as MenuElementsEmitter). All task state
/// is therefore static, and events always route through the CURRENT instance —
/// never a captured self.
@objc(BackgroundScanManager)
class BackgroundScanManager: RCTEventEmitter {

    static let appRefreshTaskId = "org.bitshala.shroud.fetchTxsForWallet"
    static let processingTaskId = "org.bitshala.shroud.scanCatchup"

    private static let enabledKey = "background_scan_enabled"
    private static let lastRunAtKey = "background_scan_last_run_at"

    private static let refreshBudgetMs = 25_000
    private static let processingBudgetMs = 4 * 60_000
    private static let listenerRetryIntervalMs = 250
    private static let listenerRetryTimeoutMs = 15_000

    private static var instance: BackgroundScanManager?
    /// Main-queue-confined. Keyed by our UUID taskId.
    private static var pendingTasks: [String: BGTask] = [:]

    private var hasListeners = false

    override init() {
        super.init()
        BackgroundScanManager.instance = self
    }

    @objc
    class func sharedInstance() -> BackgroundScanManager {
        if instance == nil {
            instance = BackgroundScanManager()
        }
        return instance!
    }

    override func supportedEvents() -> [String]! {
        return ["onBackgroundScanStart", "onBackgroundScanCancel"]
    }

    override class func requiresMainQueueSetup() -> Bool {
        return true
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    private static var isEnabled: Bool {
        return UserDefaults.standard.bool(forKey: enabledKey)
    }

    /// Emit through whichever instance currently owns the bridge.
    private static func emit(_ name: String, body: [String: Any]) -> Bool {
        guard let current = instance, current.hasListeners else { return false }
        current.sendEvent(withName: name, body: body)
        return true
    }

    // MARK: - BGTask registration & scheduling

    /// Must be called from didFinishLaunchingWithOptions, before launching finishes.
    @objc
    class func registerBGTasks() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: appRefreshTaskId, using: nil) { task in
            handle(task, timeBudgetMs: refreshBudgetMs, reason: "ios-refresh")
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: processingTaskId, using: nil) { task in
            handle(task, timeBudgetMs: processingBudgetMs, reason: "ios-processing")
        }
    }

    @objc
    class func scheduleBGTasks() {
        guard isEnabled else { return }

        let refreshRequest = BGAppRefreshTaskRequest(identifier: appRefreshTaskId)
        refreshRequest.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do {
            try BGTaskScheduler.shared.submit(refreshRequest)
        } catch {
            NSLog("[BackgroundScan] Failed to submit refresh request: \(error)")
        }

        let processingRequest = BGProcessingTaskRequest(identifier: processingTaskId)
        processingRequest.requiresNetworkConnectivity = true
        processingRequest.requiresExternalPower = false
        processingRequest.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
        do {
            try BGTaskScheduler.shared.submit(processingRequest)
        } catch {
            NSLog("[BackgroundScan] Failed to submit processing request: \(error)")
        }
    }

    private static func handle(_ task: BGTask, timeBudgetMs: Int, reason: String) {
        guard isEnabled else {
            task.setTaskCompleted(success: true)
            return
        }

        // Apple recommends rescheduling the next occurrence as soon as a task runs.
        scheduleBGTasks()

        let taskId = UUID().uuidString

        DispatchQueue.main.async {
            pendingTasks[taskId] = task
        }

        task.expirationHandler = {
            NSLog("[BackgroundScan] Task \(taskId) expired")
            _ = emit("onBackgroundScanCancel", body: ["taskId": taskId])
            complete(taskId: taskId, success: false)
        }

        // Watchdog: never leave a BGTask dangling if JS fails to answer.
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeBudgetMs + 5_000)) {
            if pendingTasks[taskId] != nil {
                NSLog("[BackgroundScan] Watchdog firing for task \(taskId)")
                complete(taskId: taskId, success: false)
            }
        }

        emitStartWhenListenerReady(taskId: taskId, timeBudgetMs: timeBudgetMs, reason: reason, elapsedMs: 0)
    }

    /// RCTEventEmitter silently drops events with no listeners. On a cold
    /// background launch the JS bundle loads asynchronously, so retry until the
    /// index.js module-scope listener attaches (or give up and complete).
    private static func emitStartWhenListenerReady(taskId: String, timeBudgetMs: Int, reason: String, elapsedMs: Int) {
        DispatchQueue.main.async {
            guard pendingTasks[taskId] != nil else { return } // already expired/completed

            let emitted = emit("onBackgroundScanStart", body: [
                "taskId": taskId,
                "timeBudgetMs": timeBudgetMs - elapsedMs,
                "reason": reason,
            ])
            if emitted { return }

            if elapsedMs >= listenerRetryTimeoutMs {
                NSLog("[BackgroundScan] No JS listener after \(elapsedMs)ms, giving up on task \(taskId)")
                complete(taskId: taskId, success: false)
                return
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(listenerRetryIntervalMs)) {
                emitStartWhenListenerReady(
                    taskId: taskId,
                    timeBudgetMs: timeBudgetMs,
                    reason: reason,
                    elapsedMs: elapsedMs + listenerRetryIntervalMs
                )
            }
        }
    }

    private static func complete(taskId: String, success: Bool) {
        DispatchQueue.main.async {
            guard let task = pendingTasks.removeValue(forKey: taskId) else { return }
            UserDefaults.standard.set(Date().timeIntervalSince1970 * 1000, forKey: lastRunAtKey)
            task.setTaskCompleted(success: success)
        }
    }

    // MARK: - JS-facing API

    @objc(start:rejecter:)
    func start(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        UserDefaults.standard.set(true, forKey: BackgroundScanManager.enabledKey)
        BackgroundScanManager.scheduleBGTasks()
        resolve(true)
    }

    @objc(stop:rejecter:)
    func stop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        UserDefaults.standard.set(false, forKey: BackgroundScanManager.enabledKey)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: BackgroundScanManager.appRefreshTaskId)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: BackgroundScanManager.processingTaskId)
        resolve(true)
    }

    @objc(getStatus:rejecter:)
    func getStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let lastRunAt = UserDefaults.standard.double(forKey: BackgroundScanManager.lastRunAtKey)
        resolve([
            "enabled": BackgroundScanManager.isEnabled,
            "lastRunAt": lastRunAt > 0 ? lastRunAt : NSNull(),
            "available": true,
        ] as [String: Any])
    }

    @objc(finish:success:)
    func finish(_ taskId: String, success: Bool) {
        BackgroundScanManager.complete(taskId: taskId, success: success)
    }

    @objc(postNotification:body:resolver:rejecter:)
    func postNotification(
        _ title: String,
        body: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                reject("bg_scan_notify_failed", error.localizedDescription, error)
            } else {
                resolve(nil)
            }
        }
    }

    @objc(requestNotificationPermission:rejecter:)
    func requestNotificationPermission(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            resolve(granted)
        }
    }
}
