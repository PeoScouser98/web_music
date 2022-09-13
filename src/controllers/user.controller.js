import User from "../models/user.model";
import transporter from "../config/nodemailer.config";
import "dotenv/config";
import jwt from "jsonwebtoken";
import { createHmac } from "crypto";

export const getUser = async (req, res) => {
	try {
		if (req.userId) {
			const user = await User.findOne({ _id: req.userId }).exec();
			return res.status(200).json({
				username: user.username,
				avatar: user.avatar,
			});
		} else throw new Error();
	} catch (error) {
		res.status(404).json({
			status: 404,
			message: "Không tìm thấy user",
		});
	}
};

export const refreshToken = async (req, res) => {
	try {
		const newAccessToken = jwt.sign({ id: req.params.id }, process.env.SECRET_KEY, { expiresIn: "15s" });
		if (newAccessToken)
			res.status(200).json({
				accessToken: newAccessToken,
				expiresIn: Date.now() + 15 * 1000,
			});
	} catch (error) {
		res.status(400).json({
			message: "Tạo refresh token không thành công",
		});
	}
};

export const login = async (req, res) => {
	try {
		const account = await User.findOne({ email: req.body.email }).exec();
		if (!account)
			return res.status(404).json({
				message: "Tài khoản không tồn tại",
			});
		if (!account.authenticate(req.body.password))
			return res.status(401).json({
				message: "Mật khẩu không đúng",
			});
		const token = jwt.sign({ id: account._id }, process.env.SECRET_KEY, { expiresIn: "15s" });
		/**
		 * * sign(data + secretKey) => token
		 * * verify(token + secretKey) => data
		 *  */

		return res.status(200).json({
			id: account._id,
			accessToken: token,
			expiresIn: Date.now() + 15 * 1000, // gửi về client thời gian hết hạn của access token
		});
	} catch (error) {
		console.log(error);
		res.status(400).json({
			message: "Đăng nhập không thành công!",
			err: error,
		});
	}
};

// đăng ký
export const register = async (req, res) => {
	try {
		const account = await User.findOne({ email: req.body.email }).exec();
		if (account)
			return res.status(400).json({
				message: "Tài khoản đã tồn tại",
			});
		const token = jwt.sign(req.body, process.env.SECRET_KEY, { expiresIn: "5m" });

		await transporter.sendMail(
			{
				from: process.env.AUTH_EMAIL,
				to: req.body.email,
				subject: "Xác thực tài khoản",
				html: /*html */ `
					<h3>Sử dụng link này để kích hoạt tài khoản</h3>
					<p><a href=${process.env.ACTIVATION_URL}?token=${token}>Link kích hoạt</a></p>
					<i>Cảm ơn đã sử dụng dịch vụ của chúng tôi !</i>`,
			},
			(error, infor) => {
				if (error) {
					return res.status(400).json({
						message: error,
					});
				} else {
					res.status(200).json({
						message: `Email sent: ${infor.response}`,
					});
				}
			},
		);
	} catch (error) {
		res.status(403).json({
			message: "Đăng ký không thành công",
			error: error,
		});
	}
};

// quên mật khẩu
export const recoverPassword = async (req, res) => {
	try {
		// lấy email đăng ký

		console.log("email gửi đến::::", req.body.email);
		const user = await User.findOne({ email: req.body.email }).exec();
		// check email nếu ko tồn tại => status 404
		if (!user)
			return res.status(404).json({
				message: "Email không tồn tại!",
			});
		console.log("password cũ:::::", user.password);
		/* tạo token*/
		const NOW = Date.now().toString();
		const verifyCode = NOW.substr(7, NOW.length - 1);
		const token = jwt.sign({ verifyCode: verifyCode }, process.env.SECRET_KEY, { expiresIn: "5m" });

		/* save token vào database */
		user.token = token;
		const updatedAccount = await User.findOneAndUpdate({ _id: user.id }, user, { new: true });
		console.log("Tài khoản mới được cập nhật :::::", updatedAccount);

		/* gửi mã xác thực về mail cho user */
		await transporter.sendMail(
			{
				from: process.env.AUTH_EMAIL,
				to: user.email,
				subject: "Sử dụng mã xác thực này để đổi mật khẩu!",
				html: /* html */ `<p>Mã xác thực: <b>${verifyCode}</b></p>`,
			},
			(err, info) => {
				if (err) return res.status(400).json(err);
			},
		);
		/* ::::::::::::: finish recover password :::::::::::::::: */
		return res.status(200).json({
			verifyCode,
			token,
		});
	} catch (error) {
		console.log(error);
		return res.status(400).json(error);
	}
};

export const resetPassword = async (req, res) => {
	try {
		const user = await User.findOne({ email: req.body.email }).exec();
		const { verifyCode } = jwt.verify(user.token, process.env.SECRET_KEY);

		/* check verify code gửi lên == verify code parse từ token lưu trong database  */
		if (verifyCode === req.body.verifyCode) {
			/* mã hóa mật khẩu trước khi save */
			const newPassword = createHmac("sha256", process.env.SECRET_KEY).update(req.body.password).digest("hex");

			/* Update mật khẩu mới và xóa token lưu trong database */
			await User.findOneAndUpdate({ email: req.body.email }, { password: newPassword, token: "" }, { new: true });

			res.status(200).json({
				message: "Reset password successfully!",
			});
		} else
			return res.status(401).json({
				message: "Mã xác thực không đúng",
			});
	} catch (error) {
		console.log(error);
		return res.status(400).json(error);
	}
};

// kích hoạt tài khoản
export const activateAccount = async (req, res) => {
	try {
		const decodedToken = jwt.verify(req.body.token, process.env.SECRET_KEY);

		if (!decodedToken) {
			return res.status(403).json({
				message: "Link xác thực đã hết hạn hoặc không tồn tại",
			});
		}
		const newAccount = await new User(decodedToken).save();
		res.status(200).json({
			email: newAccount.email,
			username: newAccount.username,
			role: newAccount.role,
		});
	} catch (error) {
		res.status(403).json({
			message: "Link xác thực tài khoản không tồn tại hoặc đã hết hạn",
		});
	}
};
