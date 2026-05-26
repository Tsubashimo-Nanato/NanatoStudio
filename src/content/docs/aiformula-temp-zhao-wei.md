---
title: "AI Formula Temporary Training Note"
description: "A temporary AI Formula training note kept as an unclassified reference."
order: 90
category: "Unclassified"
legacyPath: "docs/assets/aiformula/text/22.md"
source: "mkdocs-migration"
tags: []
---

# ZHAO WEI 训练代码 运行代码

# 训练
- `train`：可以在 Windows 跑，需要严格目录和Python 依赖。
# 运行
- `run`：这是 ROS2 在线推理节点，在 ROS2 环境里跑。

## 1. train 是

训练代码会读取：

- 图片
- 每张图片对应的控制指令 `linear_x`、`angular_z`

然后训练一个模型，让模型学会：

- 输入一张前视相机图像
- 输出两个控制量：
  - 前进速度 `linear_x`
  - 转向角速度 `angular_z`

相关文件：

- `train_simple.py`
- `train.py`
- `train02.py`
- `simplemodel.py`

## 2. train 输入格式

训练数据目录格式必须类似这样：

```text
data/extracted/某个数据集/
|-- cmdvel.csv
|-- images/
    |-- 000000.png
    |-- 000001.png
```

其中：

- `images/` 里放图片
- `cmdvel.csv` 里放标签

`cmdvel.csv` 至少要有这些列：

```csv
filename,linear_x,angular_z
000000.png,0.5,-0.1
000001.png,0.4,0.0
```

含义：

- `filename`：图片文件名
- `linear_x`：线速度
- `angular_z`：角速度

## 3. train 的输出

训练完成后会输出权重文件：

- `train_simple.py` 和 `train.py`：
  - `weights/driving_model.pth`
- `train02.py`：
  - `weights/driving_model_finetuned_curve.pth`

注意：

- `train.py` / `train_simple.py` 会覆盖 `weights/driving_model.pth`

## 4. train 依赖库

- Python
- `torch`
- `torchvision`
- `pandas`
- `numpy`
- `Pillow`

建议环境：

```bash
python -m pip install torch torchvision pandas numpy pillow
```

还需要：

- 当前工作目录要在项目根目录
- `data/extracted/...` 这些数据目录必须真实存在



## 5. train 三个脚本分别是什么

`train_simple.py`

- 用一个数据集训练
- 适合最简单的单数据集训练

`train.py`

- 用多个数据集合并训练
- 适合正式训练主模型

`train02.py`

- 用少量“curve”数据做微调
- 适合在已有模型基础上继续修正弯道表现

额外注意：

- `train02.py` 代码里要加载 `weights/driving_model_20laps.pth`
- 但当前目录里的文件名是 `weights/driving_model_20laps.pth.pth`

## 6. run 运行

`run` 上线运行。

它做的事是：

1. 从 ROS2 图像话题接收相机图像
2. 把图像送进训练好的模型
3. 预测出 `linear_x` 和 `angular_z`
4. 再发布到 ROS2 的 `cmd_vel` 话题

相关文件：

- `run.py`
- `run2.py`

- `run.py`：在线推理
- `run2.py`：在线推理，同时额外保存部分图片和预测结果

## 7. run 需要什么输入

`run` 需要：

- 一个已经训练好的权重文件
  - 默认是 `weights/driving_model.pth`
- ROS2 相机图像话题
  - 默认：`/aiformula_sensing/zed_node/left_image/undistorted`
- ROS2 控制输出话题
  - 默认：`/aiformula_control/game_pad/cmd_vel`

模型输入不是 CSV，而是实时图像流。

## 8. run 的输出是什么

`run.py` 输出：

- 发布 ROS2 `Twist` 控制指令

`run2.py` 输出：

- 发布 ROS2 `Twist`
- 额外保存日志目录、图片、`cmdvel.csv`
