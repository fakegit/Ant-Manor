
let { config, storage_name } = require('../config.js')(runtime, this)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, this)
let commonFunctions = singletonRequire('CommonFunction')
let widgetUtils = singletonRequire('WidgetUtils')
let OpenCvUtil = require('../lib/OpenCvUtil.js')
let automator = singletonRequire('Automator')
let logUtils = singletonRequire('LogUtils')
let localOcr = require('../lib/LocalOcrUtil.js')
let LogFloaty = singletonRequire('LogFloaty')
let YoloDetection = singletonRequire('YoloDetectionUtil')
let NotificationHelper = singletonRequire('Notification')
let AiUtil = require('../lib/AIRequestUtil.js')
let yoloTrainHelper = singletonRequire('YoloTrainHelper')

function Collector () {
  let _this = this
  let collectBtnContetRegex = /.*领取\d+克饲料.*/
  this.useSimpleForMatchCollect = true
  this.useSimpleForCloseCollect = true

  this.storage = storages.create(storage_name)

  this.imageConfig = config.fodder_config

  this.exec = function () {
    if (this.openCollectFood()) {
      sleep(1000)
      this.doDailyTasks()
      LogFloaty.pushLog('每日任务执行完毕，开始收集可收取饲料')
      this.collectAllIfExists()
      sleep(1000)
    } else {
      LogFloaty.pushWarningLog('未能找到领饲料入口')
      warnInfo(['未能找到领饲料入口'], true)
    }
  }

  this.openCollectFood = function (recheck) {
    let screen = commonFunctions.captureScreen()
    if (screen) {
      LogFloaty.pushLog('查找领饲料入口')
      let matchResult = this.findCollectEntry(screen)
      if (matchResult) {
        LogFloaty.pushLog('已找到领饲料入口')
        debugInfo('找到了领饲料位置' + JSON.stringify(matchResult))
        automator.click(matchResult.centerX(), matchResult.centerY())
        sleep(1000)
        if (!widgetUtils.widgetGetOne('第.*天', 2000)) {
          LogFloaty.pushLog('未能找到领饲料界面信息, 可能并没有打开领饲料界面')
          if (!recheck) {
            return this.openCollectFood(true)
          }
        }
        // 没找到关闭按钮的话也至少点击了两次 当做打开了吧
        return true
      }
    } else {
      LogFloaty.pushErrorLog('截图失败，无法校验领饲料按钮')
      return false
    }
  }

  /**
   * 查找领饲料入口
   */
  this.findCollectEntry = function (screen) {
    let originScreen = images.copy(screen)
    if (YoloDetection.enabled) {
      LogFloaty.pushLog('尝试YOLO查找领饲料入口')
      let result = YoloDetection.forward(screen, { confidence: 0.7, labelRegex: 'collect_food' })
      if (result && result.length > 0) {
        let { x, y, width, height } = result[0]
        LogFloaty.pushLog('Yolo找到：领饲料入口')
        return {
          x: x, y: y,
          centerX: () => x,
          centerY: () => y
        }
      }
    }
    if (localOcr.enabled) {
      LogFloaty.pushLog('尝试OCR查找领饲料入口')
      let result = localOcr.recognizeWithBounds(screen, null, '领饲料')
      if (result && result.length > 0) {
        return result[0].bounds
      }
    }
    LogFloaty.pushLog('ocr不支持或未找到，尝试图片查找领饲料位置')
    let matchResult = OpenCvUtil.findByGrayBase64(screen, this.imageConfig.fodder_btn)
    if (!matchResult) {
      // 尝试
      matchResult = OpenCvUtil.findBySIFTBase64(screen, this.imageConfig.fodder_btn)
      this.useSimpleForMatchCollect = false
      if (matchResult) {
        logUtils.debugInfo(['找到目标：「{},{}」[{},{}]', matchResult.roundX(), matchResult.roundY(), matchResult.width(), matchResult.height()])
        let template_img_for_collect = images.toBase64(images.clip(originScreen, matchResult.roundX(), matchResult.roundY(), matchResult.width(), matchResult.height()))
        config.overwrite('fodder.fodder_btn', template_img_for_collect)
        logUtils.debugInfo('自动更新图片配置 fodder.fodder_btn')
        logUtils.debugForDev(['自动保存匹配图片：{}', template_img_for_collect])
      }
    }
    if (matchResult) {
      toastLog('找到了领饲料位置' + JSON.stringify(matchResult))
      return matchResult
    }
  }

  this.doDailyTasks = function () {
    // 答题
    this.answerQuestion()
    // 小视频
    this.watchVideo()
    // 逛一逛
    this.browseAds()
    // 抽抽乐
    this.luckyDraw()
    // 农场施肥
    this.farmFertilize()
    // 逛一逛助农专场
    this.browseHelpFarm()
  }

  function checkAndEnter (targetWidget, targetText) {
    if (!targetWidget) {
      return null
    }
    targetText = targetText || '去完成'
    let widgetText = targetWidget.text() || ''
    if (widgetText.indexOf(targetText) > -1) {
      targetWidget.click()
      return true
    }
    return false
  }

  this.answerQuestion = function () {
    LogFloaty.pushLog('查找答题')
    let toAnswer = widgetUtils.widgetGetOne('.*去答题.*', 2000)
    let ai_type = config.ai_type || 'kimi'
    let kimi_api_key = config.kimi_api_key
    let chatgml_api_key = config.chatgml_api_key
    if (toAnswer) {
      toAnswer.click()
      sleep(1000)
      widgetUtils.widgetWaiting('题目来源.*')
      sleep(1000)
      let key = ai_type === 'kimi' ? kimi_api_key : chatgml_api_key
      if (!key) {
        LogFloaty.pushLog('推荐去KIMI开放平台申请API Key并在可视化配置中进行配置')
        LogFloaty.pushLog('否则免费接口这个智障AI经常性答错')
      }
      let result = AiUtil.getQuestionInfo(ai_type, key)
      if (result) {
        LogFloaty.pushLog('答案解释：' + result.describe)
        LogFloaty.pushLog('答案坐标：' + JSON.stringify(result.target))
        automator.click(result.target.x, result.target.y)
      } else {
        NotificationHelper.createNotification('蚂蚁庄园答题失败', '今日脚本自动答题失败，请手动处理', config.notificationId * 10 + 3)
      }
      sleep(1000)
      // TODO 随机答题
      automator.back()
    } else {
      LogFloaty.pushWarningLog('未找到答题入口')
    }
  }

  this.watchVideo = function () {
    LogFloaty.pushLog('查找看视频')
    findAndOpenTaskPage('.*庄园小视频.*', null, ({ enter }) => {
      if (enter) {
        sleep(1000)
        LogFloaty.pushLog('看视频 等待倒计时结束')
        let limit = 20
        while (limit-- > 0) {
          sleep(1000)
          LogFloaty.replaceLastLog('看视频 等待倒计时结束 剩余：' + limit + 's')
        }
        automator.back()
      } else {
        LogFloaty.pushLog('今日视频已观看')
      }
    }, () => {
      LogFloaty.pushErrorLog('未找到看视频入口')
    })
  }


  this.browseAds = function () {
    LogFloaty.pushLog('准备逛杂货铺')
    findAndOpenTaskPage('.*去杂货铺逛一逛.*', null, ({ enter }) => {
      if (enter) {
        sleep(1000)
        LogFloaty.pushLog('去杂货铺逛一逛 等待倒计时结束')
        let limit = 15
        while (limit-- > 0) {
          sleep(1000)
          LogFloaty.replaceLastLog('去杂货铺逛一逛 等待倒计时结束 剩余：' + limit + 's')
          if (limit % 2 == 0) {
            automator.randomScrollDown()
          }
        }
        if (!widgetUtils.widgetGetOne('已完成 可领饲料', 1000)) {
          LogFloaty.pushLog('去杂货铺逛一逛结束，但未找到完成控件，重新向上滑动')
          let limit = 11
          while (limit-- > 0) {
            LogFloaty.replaceLastLog('去杂货铺逛一逛 等待倒计时结束 剩余：' + limit + 's')
            if (limit % 2 == 0) {
              automator.randomScrollUp()
            }
            if (widgetUtils.widgetGetOne('已完成 可领饲料', 1000)) {
              break
            }
          }
        }
        automator.back()
      } else {
        LogFloaty.pushLog('今日广告逛完')
      }
    }, () => {
      LogFloaty.pushErrorLog('未找到杂货铺入口')
    })

  }

  this.luckyDraw = function () {
    LogFloaty.pushLog('准备抽奖')
    findAndOpenTaskPage('.*抽抽乐.*', null, ({ enter }) => {
      if (enter) {
        sleep(1000)
        LogFloaty.pushLog('抽抽乐 查找领取')
        let collect = widgetUtils.widgetGetOne('领取')
        if (collect) {
          automator.clickCenter(collect)
          sleep(1000)
          let clickBtn = widgetUtils.widgetGetOne('还剩\\d次机会')
          if (clickBtn) {
            automator.clickCenter(clickBtn)
            LogFloaty.pushLog('抽抽乐 等待抽奖结束')
            sleep(3000)
          }
        }
        automator.back()
      } else {
        LogFloaty.pushLog('今日抽奖已完成')
      }
    }, () => {
      LogFloaty.pushErrorLog('未找到抽抽乐入口')
    })
  }

  this.farmFertilize = function () {
    LogFloaty.pushLog('准备施肥')
    findAndOpenTaskPage('.*庄园小视频.*', null, ({ enter }) => {
      if (enter) {
        sleep(1000)
        LogFloaty.pushLog('等待进入芭芭农场')
        widgetUtils.widgetWaiting('任务列表')
        sleep(1000)
        LogFloaty.pushLog('查找 施肥 按钮')
        let result = localOcr.recognizeWithBounds(commonFunctions.captureScreen(), null, '肥料.*\\d+')
        if (result && result.length > 0) {
          let bounds = result[0].bounds
          LogFloaty.pushLog('施肥按钮位置：' + JSON.stringify({ x: bounds.centerX(), y: bounds.centerY() }))
          automator.click(bounds.centerX(), bounds.centerY())
        } else {
          LogFloaty.pushLog('未找到施肥按钮')
        }
        automator.back()
      } else {
        LogFloaty.pushLog('今日施肥已完成')
      }
    }, () => {
      LogFloaty.pushErrorLog('未找到施肥入口')
    })


  }

  this.browseHelpFarm = function () {
    LogFloaty.pushLog('准备逛一逛助农专场')
    findAndOpenTaskPage('.*逛一逛.*助农专场.*', null, result => {
      let enter = result.enter
      if (enter) {
        LogFloaty.pushLog('等待进入助农专场')
        widgetUtils.widgetWaiting('点击或滑动浏览得肥料')
        sleep(1000)
        LogFloaty.pushLog('啥也不用干 直接返回')
        automator.back()
      } else {
        LogFloaty.pushLog('今日逛一逛助农专场已完成')
      }
    }, e => {
      LogFloaty.pushWarningLog('未找到逛一逛助农专场入口: ' + e)
    })
  }

  function findAndOpenTaskPage (titleRegex, btnText, callback, errorCallback) {
    btnText = btnText || '去完成'
    let title = widgetUtils.widgetGetOne(titleRegex, 2000)
    let checkResult = checkAndEnter(title, btnText)
    if (checkResult) {
      sleep(1000)
      return callback({ enter: true })
    } else {
      if (checkResult == null) {
        errorCallback('未能找到：' + titleRegex)
      } else {
        callback({ enter: false })
      }
    }
  }

  function collectCurrentVisible (tryTime) {
    tryTime = tryTime || 0
    if (tryTime > 10) {
      logUtils.warnInfo(['循环领取超过10次 可能页面卡死 直接退出'])
      _this.collected = false
      return false
    }
    auto.clearCache && auto.clearCache()
    let visiableCollect = widgetUtils.widgetGetAll(collectBtnContetRegex) || []
    let originList = visiableCollect
    if (visiableCollect.length > 0) {
      visiableCollect = visiableCollect.filter(v => v.visibleToUser() && checkIsValid(v))
    }
    if (visiableCollect.length > 0) {
      _this.collected = true
      logUtils.debugInfo(['点击领取'])
      // TODO 确保按钮可见
      automator.clickCenter(visiableCollect[0])
      sleep(500)
      let full = widgetUtils.widgetGetOne(config.fodder_config.feed_package_full || '饲料袋.*满.*|知道了', 1000)
      if (full) {
        LogFloaty.pushWarningLog('饲料袋已满')
        logUtils.warnInfo(['饲料袋已满'], true)
        _this.food_is_full = true
        let confirmBtn = widgetUtils.widgetGetOne('知道了', 1000)
        if (confirmBtn) {
          automator.clickCenter(confirmBtn)
          sleep(1000)
          return false
        }
        let closeIcon = className('android.widget.Image').depth(18).findOne(1000)
        if (closeIcon) {
          yoloTrainHelper.saveImage(commonFunctions.captureScreen(), '关闭按钮', 'close_icon')
          automator.clickCenter(closeIcon)
          sleep(1000)
        }
        return false
      }
      return collectCurrentVisible(tryTime + 1)
    } else {
      _this.collected = false
      logUtils.debugInfo(['可领取控件均无效或不可见：{}', JSON.stringify((() => {
        return originList.map(target => {
          let bounds = target.bounds()
          let visibleToUser = target.visibleToUser()
          return { visibleToUser, x: bounds.left, y: bounds.top, width: bounds.width(), height: bounds.height() }
        })
      })())])
    }
    let allCollect = widgetUtils.widgetGetAll(collectBtnContetRegex)
    return allCollect && allCollect.length > 0
  }

  this.collectAllIfExists = function (lastTotal, findTime) {
    if (findTime >= 5) {
      LogFloaty.pushWarningLog('超过5次未找到可收取控件，退出查找')
      this.closeFoodCollection()
      return
    }
    LogFloaty.pushLog('查找 领取 按钮')
    let allCollect = widgetUtils.widgetGetAll(collectBtnContetRegex)
    if (allCollect && allCollect.length > 0) {
      let total = allCollect.length
      if (collectCurrentVisible()) {
        logUtils.logInfo(['滑动下一页查找目标'], true)
        let startY = config.device_height - config.device_height * 0.15
        let endY = startY - config.device_height * 0.3
        automator.gestureDown(startY, endY)
      } else if (this.food_is_full) {
        this.closeFoodCollection()
        return
      }
      sleep(500)
      if (!this.collected) {
        findTime = findTime ? findTime : 1
      } else {
        findTime = null
      }
      this.collectAllIfExists(total, findTime ? findTime + 1 : null)
    } else {
      this.closeFoodCollection()
    }
  }

  this.closeFoodCollection = function () {
    LogFloaty.pushWarningLog('无可领取饲料')
    logUtils.warnInfo(['无可领取饲料'], true)
    if (YoloDetection.enabled) {
      let result = YoloDetection.forward(commonFunctions.captureScreen(), { confidence: 0.7, labelRegex: 'close_btn' })
      if (result && result.length > 0) {
        LogFloaty.pushLog('通过yolo找到了关闭按钮')
        automator.click(result[0].x, result[0].y)
      } else {
        LogFloaty.pushWarningLog('无法通过yolo查找到关闭按钮')
        logUtils.warnInfo(['无法通过yolo查找到关闭按钮'])
        automator.back()
      }
    } else {
      let screen = commonFunctions.captureScreen()
      if (screen) {
        screen = images.copy(images.grayscale(screen), true)
        let originScreen = images.copy(images.cvtColor(screen, "GRAY2BGRA"))
        let matchResult = OpenCvUtil.findByGrayBase64(screen, config.fodder_config.close_interval, true)
        if (!matchResult) {
          matchResult = OpenCvUtil.findBySIFTBase64(screen, config.fodder_config.close_interval)
          this.useSimpleForCloseCollect = false
        }
        if (matchResult) {
          automator.click(matchResult.centerX(), matchResult.centerY())
          if (!this.useSimpleForCloseCollect) {
            let template_img_for_close_collect = images.toBase64(images.clip(originScreen, matchResult.left, matchResult.top, matchResult.width(), matchResult.height()))
            config.overwrite('fodder.close_interval', template_img_for_close_collect)
            logUtils.debugInfo('自动更新图片配置 fodder.close_interval')
            logUtils.debugForDev(['自动保存匹配图片：{}', template_img_for_close_collect])
          }
        } else {
          logUtils.warnInfo(['无法通过图片查找到关闭按钮'])
          automator.back()
        }
        screen.recycle()
      }
    }
  }
}

module.exports = new Collector()

/**
 * 判断高度是否符合条件
 *
 * @param {UIObject} target 
 * @returns 
 */
function checkIsValid (target) {
  let bounds = target.bounds()
  if (bounds.height() < 10) {
    logUtils.debugInfo(['控件高度小于10，无效控件'])
    return false
  }
  return true
}

/**
 * @deprecated OCR不准放弃 
 * @param {*} regex 
 * @param {*} target 
 * @param {*} screen 
 * @returns 
 */
function checkOcrText (regex, target, screen) {
  let bounds = target.bounds()
  if (bounds.height() < 10) {
    logUtils.debugInfo(['控件高度小于10，无效控件'])
    return false
  }
  if (!localOcr.enabled) {
    return true
  }
  screen = screen || commonFunctions.checkCaptureScreenPermission()
  if (screen) {
    let region = [bounds.left, bounds.top, bounds.width(), bounds.height()]
    logUtils.debugInfo(['截取图片信息: data:image/png;base64,{}', images.toBase64(images.clip(screen, region[0], region[1], region[2], region[3]))])
    // 进行灰度处理 降低干扰
    screen = images.grayscale(screen)
    logUtils.debugInfo(['校验图片区域文字信息：{}', JSON.stringify(region)])
    let text = localOcr.recognize(screen, region)
    if (text) {
      text = text.replace(/\n/g, '')
      return new RegExp(regex).test(regex)
    }
  }
  return false
}